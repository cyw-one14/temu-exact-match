"""Compare external foreground silhouettes only; original images stay unchanged."""
import base64
import math
import time
import cv2
import numpy as np

REVISION = 'subject-outline-v1'
SIDE, RADIUS = 96, 40
REQUIRED_IOU, REQUIRED_BOUNDARY = .90, .90


def parts(encoded, attention, decode):
    _, mask = decode(encoded, True, 224)
    if attention:
        weights = np.frombuffer(base64.b64decode(attention, validate=True), np.uint8)
        side = math.isqrt(weights.size)
        if side * side != weights.size or side < 16:
            raise ValueError('invalid outline attention mask')
        weights = cv2.resize(weights.reshape(side, side), (mask.shape[1], mask.shape[0]), interpolation=cv2.INTER_NEAREST)
        mask = np.where((mask > 0) & (weights >= 204), 255, 0).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    total = cv2.countNonZero(mask)
    largest = max((int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, count)), default=0)
    eligible = [i for i in range(1, count) if stats[i, cv2.CC_STAT_AREA] >= max(80, total * .06, largest * .35)
                and min(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]) >= 10]
    eligible.sort(key=lambda i: int(stats[i, cv2.CC_STAT_AREA]), reverse=True)
    result = []
    for i in eligible[:6]:
        region = np.uint8(labels == i) * 255
        contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        # Interior texture/holes are not an external outline. Do not use a hull:
        # finger gaps, handles and other concavities must remain in the silhouette.
        filled = np.zeros_like(region)
        cv2.drawContours(filled, contours, -1, 255, cv2.FILLED)
        ys, xs = np.where(filled > 0)
        cx, cy = float(xs.mean()), float(ys.mean())
        radius = float(np.hypot(xs - cx, ys - cy).max())
        if radius < 5:
            continue
        scale = RADIUS / radius
        transform = np.float32([[scale, 0, SIDE / 2 - cx * scale], [0, scale, SIDE / 2 - cy * scale]])
        normalized = cv2.warpAffine(filled, transform, (SIDE, SIDE), flags=cv2.INTER_NEAREST)
        result.append(normalized)
    return result


def iou(a, b):
    return float(np.count_nonzero((a > 0) & (b > 0)) / max(1, np.count_nonzero((a > 0) | (b > 0))))


def boundary_coverage(a, b):
    kernel = np.ones((3, 3), np.uint8)
    ea, eb = a - cv2.erode(a, kernel), b - cv2.erode(b, kernel)
    da = cv2.distanceTransform(np.uint8(ea == 0), cv2.DIST_L2, 5)
    db = cv2.distanceTransform(np.uint8(eb == 0), cv2.DIST_L2, 5)
    return float(min(np.mean(db[ea > 0] <= 2), np.mean(da[eb > 0] <= 2)))


def compare_outlines(template, candidate, decode, template_attention=None, candidate_attention=None):
    start = time.perf_counter()
    base = {'revision': REVISION, 'valid': False, 'matched': False,
            'required': {'iou': REQUIRED_IOU, 'boundaryCoverage': REQUIRED_BOUNDARY},
            'scope': 'segmented-product-outline', 'normalization': 'uniform-scale-centroid', 'grid': SIDE,
            'boundaryTolerancePixels': 2}
    try:
        aa, bb = parts(template, template_attention, decode), parts(candidate, candidate_attention, decode)
    except ValueError as error:
        return {**base, 'reason': '主体轮廓掩码不可用：' + str(error)[:100]}
    if not aa or not bb:
        return {**base, 'reason': '未提取到足够完整的主体轮廓，保留无法确认'}
    best = None
    tested = 0
    for ai, a in enumerate(aa):
        for bi, b in enumerate(bb):
            pair_best = None
            for mirror in [False, True]:
                source = cv2.flip(a, 1) if mirror else a
                for angle in range(0, 360, 5):
                    transform = cv2.getRotationMatrix2D((SIDE / 2, SIDE / 2), angle, 1)
                    rotated = cv2.warpAffine(source, transform, (SIDE, SIDE), flags=cv2.INTER_NEAREST)
                    score = iou(rotated, b)
                    if pair_best is None or score > pair_best[0]:
                        pair_best = (score, mirror, angle, rotated)
            coarse = pair_best
            source = cv2.flip(a, 1) if coarse[1] else a
            for angle in range(coarse[2] - 2, coarse[2] + 3):
                transform = cv2.getRotationMatrix2D((SIDE / 2, SIDE / 2), angle, 1)
                rotated = cv2.warpAffine(source, transform, (SIDE, SIDE), flags=cv2.INTER_NEAREST)
                score = iou(rotated, b)
                if score > pair_best[0]:
                    pair_best = (score, coarse[1], angle % 360, rotated)
            tested += 1
            overlap, mirror, angle, aligned = pair_best
            boundary = boundary_coverage(aligned, b)
            matched = overlap >= REQUIRED_IOU and boundary >= REQUIRED_BOUNDARY
            result = {'iou': overlap, 'boundaryCoverage': boundary, 'similarity': min(overlap, boundary),
                      'matched': matched, 'orientation': {'mirror': mirror, 'rotation': angle},
                      'regions': {'reference': ai, 'candidate': bi}}
            if best is None or result['matched'] and not best['matched'] or result['matched'] == best['matched'] and result['similarity'] > best['similarity']:
                best = result
            if matched:
                break
        if best['matched']:
            break
    return {**base, **best, 'valid': True, 'components': {'reference': len(aa), 'candidate': len(bb)},
            'testedPairs': tested, 'elapsedMs': round((time.perf_counter() - start) * 1000),
            'reason': '主体轮廓相似，按用户轮廓补充规则归为同款；不是同款概率' if best['matched'] else '主体轮廓未同时达到重合与边界门槛，保留无法确认'}
