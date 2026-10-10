import sys, os, base64, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from feature_worker import compare
import cv2
import numpy as np

root = Path(__file__).resolve().parents[1] / '.cache' / 'subject-validation'
template = (root / 'glove-subject.png').read_bytes()
encode = lambda data: base64.b64encode(data).decode()
rgba = cv2.imdecode(np.frombuffer(template, np.uint8), cv2.IMREAD_UNCHANGED)
alpha = rgba[:, :, 3:4].astype(np.float32)/255
neutral = (rgba[:, :, :3] * alpha + 255*(1-alpha)).astype(np.uint8)
jpg = cv2.imencode('.jpg', neutral, [cv2.IMWRITE_JPEG_QUALITY, 75])[1].tobytes()
edited = neutral.copy();cv2.rectangle(edited, (100, 65), (145, 110), (255, 255, 255), -1)
partial = np.full_like(neutral, 255);partial[35:85, 35:85] = neutral[35:85, 35:85]
one_glove = neutral.copy();one_glove[:, :112] = 255
cases = [('background', (root/'same-subject-new-background.png').read_bytes(), True), ('rotation', (root/'rotated-subject.png').read_bytes(), True), ('jpeg', jpg, True), ('color', (root/'changed-color.png').read_bytes(), False), ('structure', cv2.imencode('.png', edited)[1].tobytes(), False), ('partial-only', cv2.imencode('.png', partial)[1].tobytes(), False), ('missing-one', cv2.imencode('.png', one_glove)[1].tobytes(), False), ('blank', cv2.imencode('.png', np.full_like(neutral,255))[1].tobytes(), False)]
records = []
for algorithm in ['AKAZE', 'SIFT']:
    for name, image, expected in cases:
        result = compare(encode(template), encode(image), algorithm)
        records.append({'case': name, 'expected': expected, **result});print(json.dumps(records[-1], ensure_ascii=False), flush=True)
tooth = (root/'toothpaste-subject.png').read_bytes()
tr = cv2.imdecode(np.frombuffer(tooth, np.uint8), cv2.IMREAD_UNCHANGED)
weight = tr[:,:,3:4].astype(np.float32)/255
tn = (tr[:,:,:3]*weight+255*(1-weight)).astype(np.uint8)
holder = tn.copy();region=holder[95:];gray=np.max(region,axis=2)-np.min(region,axis=2)<12;region[gray]=255
logos = tn.copy();logos[95:]=255
half = tn.copy();half[:,112:]=255
retint = cv2.cvtColor(tn,cv2.COLOR_BGR2HSV);retint[:,:,0]=(retint[:,:,0].astype(np.int16)+75)%180;retint=cv2.cvtColor(retint,cv2.COLOR_HSV2BGR)
rotated = cv2.warpAffine(tn,cv2.getRotationMatrix2D((112,112),12,1),(224,224),borderValue=(255,255,255))
small=tn.copy();region=small[165:198,132:182];gray=np.max(region,axis=2)-np.min(region,axis=2)<12;region[gray]=255
tcases=[('tooth-jpeg',cv2.imencode('.jpg',tn,[cv2.IMWRITE_JPEG_QUALITY,75])[1].tobytes(),True),('tooth-rotation',cv2.imencode('.png',rotated)[1].tobytes(),True),('tooth-wrong-white-holder',cv2.imencode('.png',holder)[1].tobytes(),False),('tooth-small-holder-detail',cv2.imencode('.png',small)[1].tobytes(),False),('tooth-shared-logos-only',cv2.imencode('.png',logos)[1].tobytes(),False),('tooth-missing-two',cv2.imencode('.png',half)[1].tobytes(),False),('tooth-color',cv2.imencode('.png',retint)[1].tobytes(),False),('tooth-vs-gloves',cases[2][1],False)]
for name,image,expected in tcases:
    result=compare(encode(tooth),encode(image),'SIFT');records.append({'case':name,'expected':expected,**result});print(json.dumps(records[-1],ensure_ascii=False),flush=True)
(root/'feature-trial.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf8')
false_passes=[item['case'] for item in records if not item['expected'] and item['matched']]
assert not false_passes, 'Fast false positives: '+str(false_passes)
assert sum(item['matched'] for item in records if item['algorithm']=='SIFT' and item['expected'])>=3
