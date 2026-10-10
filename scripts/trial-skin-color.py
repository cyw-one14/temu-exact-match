"""Offline color-attention experiment. Original images/alpha and verdicts stay unchanged."""
from pathlib import Path
import hashlib
import json
import cv2
import numpy as np

root = Path(__file__).resolve().parents[1] / '.cache' / 'subject-validation'
names = ['comb-reference-cached', 'comb-candidate-cached', 'glove-subject', 'toothpaste-subject']

def skin_color(bgr):
    # Deliberately broad heuristic, NOT a skin/person detector. Thresholds are
    # experimental choices; wood and beige products can share this color range.
    ycrcb = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    return (ycrcb[:, :, 1] >= 133) & (ycrcb[:, :, 1] <= 180) & (ycrcb[:, :, 2] >= 77) & (ycrcb[:, :, 2] <= 135)

def centers(values):
    values = np.float32(values)
    if len(values) < 40:
        return None
    # Deterministic per-image color prototypes, allowing uneven illumination.
    cv2.setRNGSeed(7)
    _, _, result = cv2.kmeans(values, min(3, len(values)), None,
                            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 40, .1),
                            3, cv2.KMEANS_PP_CENTERS)
    return result

def distance(lab, prototypes):
    return np.sqrt(((lab[:, :, None, :] - prototypes[None, None, :, :]) ** 2).sum(axis=3)).min(axis=2)

def fraction(mask, region):
    return float(mask[region].mean()) if region.any() else None

# Interior diagnostic probes chosen from the visible cached images. They are
# approximate regions, NOT pixel-perfect annotations and NOT a user workflow.
probes = {
    'comb-reference-cached': {'wood': [(133, 67, 155, 119), (108, 130, 145, 151), (39, 137, 51, 174)],
                              'hand': [(191, 44, 211, 142)]},
    'comb-candidate-cached': {'wood': [(94, 65, 115, 111), (70, 176, 89, 187)],
                              'hand': [(154, 125, 190, 177)]},
}
records = []
for name in names:
    path = root / f'{name}.png'
    original = path.read_bytes()
    rgba = cv2.imdecode(np.frombuffer(original, np.uint8), cv2.IMREAD_UNCHANGED)
    bgr = rgba[:, :, :3].copy()
    foreground = rgba[:, :, 3] >= 160
    hand = cv2.imread(str(root / f'{name}-hand-prob.png'), 0).astype(np.int16)
    product = cv2.imread(str(root / f'{name}-product-prob.png'), 0).astype(np.int16)
    colors = skin_color(bgr) & foreground
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    semantic_hand = foreground & (hand >= 160) & (hand > product + 25)
    skin_seeds = foreground & colors & (hand >= 180) & (hand > product + 50)
    product_seeds = foreground & ((hand < 100) | (product > hand + 25))
    skin_centers, product_centers = centers(lab[skin_seeds]), centers(lab[product_seeds])
    focused_hand = np.zeros_like(foreground)
    enabled = skin_centers is not None and product_centers is not None
    if enabled:
        skin_distance = distance(lab, skin_centers)
        product_distance = distance(lab, product_centers)
        # Retain ambiguous wood/skin colors. Color alone never disables evidence.
        focused_hand = semantic_hand & colors & (skin_distance < 24) & (skin_distance + 12 < product_distance)
    weights = np.where(focused_hand, 26, 255).astype(np.uint8)
    cv2.imwrite(str(root / f'{name}-color-attention.png'), weights)
    # Diagnostic overlay only: red identifies pixels the COLOR-ONLY heuristic
    # would call skin. This does not edit the input or a production preview.
    alpha = rgba[:, :, 3:4].astype(np.float32) / 255
    flat = (bgr * alpha + 238 * (1 - alpha)).astype(np.uint8)
    overlay = flat.copy()
    overlay[colors] = (.45 * overlay[colors] + .55 * np.array([0, 0, 255])).astype(np.uint8)
    cv2.imwrite(str(root / f'{name}-skin-color-overlay.png'), overlay)
    probe_results = {}
    for label, rectangles in probes.get(name, {}).items():
        region = np.zeros_like(foreground)
        for x0, y0, x1, y1 in rectangles:
            region[y0:y1, x0:x1] = True
        region &= foreground
        probe_results[label] = {'pixels': int(region.sum()), 'colorOnlySkinFraction': fraction(colors, region),
                                'hybridDownweightedFraction': fraction(focused_hand, region)}
    record = {'sample': name, 'foregroundPixels': int(foreground.sum()),
              'colorOnlySkinFraction': fraction(colors, foreground),
              'semanticOnlyDownweightedFraction': fraction(semantic_hand, foreground),
              'hybridDownweightedFraction': fraction(focused_hand, foreground),
              'adaptiveColorEnabled': enabled, 'skinSeedPixels': int(skin_seeds.sum()),
              'productSeedPixels': int(product_seeds.sum()), 'diagnosticProbes': probe_results,
              'originalUnchanged': hashlib.sha256(original).digest() == hashlib.sha256(path.read_bytes()).digest()}
    records.append(record)
    print(json.dumps(record), flush=True)

# Identical colors are observationally indistinguishable by any color-only rule.
swatches = []
for label, rgb in [('wood-brown', [140, 90, 55]), ('beige-product-or-skin', [219, 170, 140]),
                   ('dark-brown-product-or-skin', [85, 53, 37]), ('green-product', [110, 160, 110])]:
    image = np.array([[list(reversed(rgb))]], dtype=np.uint8)
    swatches.append({'label': label, 'rgb': rgb, 'colorOnlyCallsSkin': bool(skin_color(image)[0, 0])})
report = {'experimental': True, 'productionEnabled': False, 'method': 'Color-only broad YCrCb heuristic vs semantic+adaptive-Lab color attention',
          'records': records, 'swatches': swatches,
          'note': 'Diagnostic probes approximate only visible interior areas; no whole-product segmentation accuracy claimed. Weights never prove product identity.'}
(root / 'skin-color-trial.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
assert all(item['originalUnchanged'] for item in records)
print(json.dumps({'originalsUnchanged': True, 'productionEnabled': False, 'swatches': swatches}))
