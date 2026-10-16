"""Local image-only feature matching. No browser, network, or file inputs."""
import base64
import hashlib
import json
import sys
import time
from collections import OrderedDict
import cv2
import numpy as np

cv2.setNumThreads(1)
CACHE = OrderedDict()

def decode(value, template=False, max_side=384):
    raw = base64.b64decode(value, validate=True)
    if len(raw) > 8_000_000:
        raise ValueError('image too large')
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
    if image is None or image.shape[0] * image.shape[1] > 4_000_000:
        raise ValueError('invalid image')
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    alpha = image[:, :, 3] if image.shape[2] == 4 else None
    rgb = image[:, :, :3]
    if alpha is not None:
        weight = alpha.astype(np.float32)[:, :, None] / 255
        rgb = (rgb * weight + 255 * (1 - weight)).astype(np.uint8)
    mask = ((alpha >= 160).astype(np.uint8) * 255) if alpha is not None else None
    if template and (mask is None or cv2.countNonZero(mask) == mask.size):
        raise ValueError('reference subject mask required')
    height, width = rgb.shape[:2]
    scale = max_side / max(height, width)
    rgb = cv2.resize(rgb, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_LINEAR)
    if mask is not None:
        mask = cv2.resize(mask, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_NEAREST)
    return rgb, mask

def features(value, name, template=False, mirror=False, quarter_turns=0, attention=None):
    key = hashlib.sha256((name + str(template) + str(mirror) + str(quarter_turns) + value + (attention or '')).encode()).hexdigest()
    if key in CACHE:
        CACHE.move_to_end(key)
        return CACHE[key]
    image, mask = decode(value, template)
    if attention is not None:
        # Pixel data/alpha stays unchanged. Only the comparison/detector domain
        # uses confidently retained product evidence from the semantic-color map.
        weights = base64.b64decode(attention, validate=True)
        if len(weights) != 224 * 224:
            raise ValueError('invalid attention weights')
        region = np.frombuffer(weights, np.uint8).reshape(224, 224)
        region = cv2.resize(region, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
        if mask is None:
            raise ValueError('foreground required for focused detail checking')
        mask = np.where((mask > 0) & (region >= 204), 255, 0).astype(np.uint8)
    if mirror:
        image=cv2.flip(image,1)
        if mask is not None:mask=cv2.flip(mask,1)
    if quarter_turns:
        image=np.ascontiguousarray(np.rot90(image,-quarter_turns))
        if mask is not None:mask=np.ascontiguousarray(np.rot90(mask,-quarter_turns))
    detector = cv2.AKAZE_create(threshold=.0006) if name == 'AKAZE' else cv2.SIFT_create(nfeatures=1600, contrastThreshold=.02)
    points, descriptors = detector.detectAndCompute(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), mask if template or attention is not None else None)
    result = (image, mask, points, descriptors)
    CACHE[key] = result
    while len(CACHE) > 192:
        CACHE.popitem(last=False)
    return result

def compare(template, candidate, name='SIFT', mirror=False, quarter_turns=0, template_attention=None, candidate_attention=None):
    start = time.perf_counter()
    a, mask, ka, da = features(template, name, True, mirror, quarter_turns, template_attention)
    b, candidate_mask, kb, db = features(candidate, name, attention=candidate_attention)
    result = {'algorithm': name, 'matched': False, 'referencePoints': len(ka), 'candidatePoints': len(kb), 'inliers': 0}
    def finish(reason):
        result.update(reason=reason, elapsedMs=round((time.perf_counter() - start) * 1000))
        return result
    if da is None or db is None or min(len(ka), len(kb)) < 24:
        return finish('主体特征点不足，保留原主体模型复核')
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING if name == 'AKAZE' else cv2.NORM_L2)
    def pairs(points, descriptors):
        forward = matcher.knnMatch(da, descriptors, k=2)
        reverse = matcher.knnMatch(descriptors, da, k=2)
        back = {x.queryIdx: x.trainIdx for pair in reverse if len(pair) == 2 for x, y in [pair] if x.distance < .75 * y.distance}
        return [x for pair in forward if len(pair) == 2 for x, y in [pair] if x.distance < .75 * y.distance and back.get(x.trainIdx) == x.queryIdx]
    good = pairs(kb,db)
    if 6<=len(good)<24:
        # A tentative region only filters existing scene keypoints; no pixels or
        # edges are fabricated. Full geometry/color/detail gates still apply.
        rough_a=np.float32([ka[x.queryIdx].pt for x in good])
        rough_b=np.float32([kb[x.trainIdx].pt for x in good])
        cv2.setRNGSeed(7)
        guess,_=cv2.findHomography(rough_a,rough_b,cv2.RANSAC,2.5)
        if guess is not None and np.isfinite(guess).all():
            search=cv2.warpPerspective(mask,guess,(b.shape[1],b.shape[0]),flags=cv2.INTER_NEAREST)
            search=cv2.dilate(search,np.ones((9,9),np.uint8))
            indexes=[i for i,point in enumerate(kb) if search[min(b.shape[0]-1,round(point.pt[1])),min(b.shape[1]-1,round(point.pt[0]))]>0]
            if len(indexes)>=24:
                selected=[kb[i] for i in indexes]
                rematched=pairs(selected,db[indexes])
                if len(rematched)>len(good):
                    good,kb=rematched,selected
                    result['regionRefined']=True
    result['mutualMatches'] = len(good)
    if len(good) < 24:
        return finish('双向匹配证据不足')
    pa = np.float32([ka[x.queryIdx].pt for x in good])
    pb = np.float32([kb[x.trainIdx].pt for x in good])
    cv2.setRNGSeed(7)
    h, inlier_mask = cv2.findHomography(pa, pb, cv2.RANSAC, 2.5)
    if h is None or not np.isfinite(h).all():
        return finish('几何对应未建立')
    inlier = inlier_mask.ravel().astype(bool)
    points = pa[inlier]
    result.update(inliers=int(inlier.sum()), inlierRatio=float(inlier.mean()))
    if inlier.sum() < 24 or inlier.mean() < .75:
        return finish('几何一致点不足')
    ys, xs = np.where(mask > 0)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    hull = cv2.convexHull(points)
    area = max(1, (x1 - x0) * (y1 - y0))
    coverage = cv2.contourArea(hull) / area
    rows = {min(2, int((y - y0) * 3 / max(1, y1 - y0 + 1))) for x, y in points}
    columns = {min(2, int((x - x0) * 3 / max(1, x1 - x0 + 1))) for x, y in points}
    result['subjectCoverage'] = float(coverage)
    if coverage < .30 or len(rows) < 3 or len(columns) < 2:
        return finish('匹配只覆盖局部，不能凭商标或包装确认主体')
    try:
        inverse = np.linalg.inv(h)
    except np.linalg.LinAlgError:
        return finish('几何对应不可逆')
    aligned = cv2.warpPerspective(b, inverse, (a.shape[1], a.shape[0]), flags=cv2.INTER_LINEAR)
    visible = cv2.warpPerspective(np.ones(b.shape[:2], np.uint8), inverse, (a.shape[1], a.shape[0]), flags=cv2.INTER_NEAREST) > 0
    if candidate_attention is not None:
        visible &= cv2.warpPerspective(candidate_mask, inverse, (a.shape[1], a.shape[0]), flags=cv2.INTER_NEAREST) > 0
    interior = cv2.erode(mask, np.ones((5, 5), np.uint8)) > 0
    if not interior.any() or (visible & interior).sum() / interior.sum() < .98:
        return finish('候选未覆盖完整主体')
    delta = np.abs(a.astype(np.float32) - aligned.astype(np.float32)).mean(axis=2)
    mean_error, percentile = float(delta[interior].mean()), float(np.percentile(delta[interior], 90))
    local_errors = []
    for row in range(4):
        for col in range(4):
            top, bottom = y0 + row * (y1-y0+1)//4, y0 + (row+1) * (y1-y0+1)//4
            left, right = x0 + col * (x1-x0+1)//4, x0 + (col+1) * (x1-x0+1)//4
            region = interior[top:bottom, left:right]
            if region.sum() >= 50:
                local_errors.append(float(delta[top:bottom, left:right][region].mean()))
    worst = max(local_errors, default=255)
    # White/gray mechanical parts can differ while packaging and colored knobs
    # stay identical. Check finer neutral-detail regions separately; luminance
    # avoids treating JPEG chroma bleed as a changed white part.
    neutral=(a.max(axis=2).astype(np.int16)-a.min(axis=2).astype(np.int16)<12)&(a.mean(axis=2)>125)&interior
    gray_delta=np.abs(cv2.cvtColor(a,cv2.COLOR_BGR2GRAY).astype(np.float32)-cv2.cvtColor(aligned,cv2.COLOR_BGR2GRAY).astype(np.float32))
    neutral_errors=[]
    for row in range(8):
        for col in range(8):
            top,bottom=y0+row*(y1-y0+1)//8,y0+(row+1)*(y1-y0+1)//8
            left,right=x0+col*(x1-x0+1)//8,x0+(col+1)*(x1-x0+1)//8
            region=neutral[top:bottom,left:right]
            if region.sum()>=20:
                neutral_errors.append(float(gray_delta[top:bottom,left:right][region].mean()))
    neutral_worst=max(neutral_errors,default=0)
    result.update(colorError=mean_error,colorError90=percentile,worstRegionError=worst,neutralDetailError=neutral_worst)
    # Passing requires aligned whole-subject colors AND all occupied detail regions.
    # Failure is inconclusive and falls back; it does not exclude a product.
    result['matched'] = mean_error <= 7 and percentile <= 16 and worst <= 12 and neutral_worst <= 10
    return finish('主体分布、几何对应、颜色和局部图像内容一致' if result['matched'] else '颜色或局部内容不一致，转入主体模型')

def compare_orientations(template,candidate,name='SIFT'):
    start=time.perf_counter();attempts=[];best=None
    for mirror,turns in [(False,0),(True,0),(False,1),(False,2),(False,3),(True,1),(True,2),(True,3)]:
        result=compare(template,candidate,name,mirror,turns)
        orientation={'mirror':mirror,'rotation':turns*90}
        attempts.append({**orientation,'matched':result['matched'],'inliers':result['inliers']})
        if best is None or result.get('inliers',0)>best.get('inliers',0):best={**result,'orientation':orientation}
        if result['matched']:
            best={**result,'orientation':orientation};break
    best.update(orientationAttempts=attempts,elapsedMs=round((time.perf_counter()-start)*1000))
    return best

if __name__ == '__main__':
    print(json.dumps({'ready': True, 'opencv': cv2.__version__}), flush=True)
    for line in sys.stdin:
        try:
            data = json.loads(line)
            if data.get('operation') == 'outline-match':
                from outline_match import compare_outlines
                result = compare_outlines(data['template'], data['candidate'], decode, data.get('templateAttention'), data.get('candidateAttention'))
            elif data.get('operation') == 'reference-shape':
                from instance_match import compatible_shape
                result = compatible_shape(data['template'],data['candidate'],decode)
            elif data.get('operation') == 'instance-match':
                from instance_match import compare_instances
                result = compare_instances(data['template'],data['candidate'],decode,data.get('templateAttention'))
            elif data.get('operation') == 'focused-details':
                result = compare(data['template'], data['candidate'], data.get('algorithm', 'SIFT'),
                                 template_attention=data['templateAttention'], candidate_attention=data['candidateAttention'])
            else:
                result = compare_orientations(data['template'], data['candidate'], data.get('algorithm', 'SIFT'))
            print(json.dumps({'id': data['id'], 'ok': True, 'comparison': result}, ensure_ascii=True), flush=True)
        except Exception as error:
            print(json.dumps({'id': data.get('id') if 'data' in locals() else None, 'ok': False, 'error': str(error)[:200]}), flush=True)
