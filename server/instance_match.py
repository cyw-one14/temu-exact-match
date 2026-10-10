"""Complete foreground-instance matching in a repeated scene. No I/O or network."""
import cv2
import numpy as np
import base64
import hashlib
from collections import OrderedDict

CACHE = OrderedDict()

def compatible_shape(reference,other,decode):
    def regions(encoded):
        _,mask=decode(encoded,True);count,labels,stats,_=cv2.connectedComponentsWithStats(mask)
        ids=[i for i in range(1,count) if stats[i,cv2.CC_STAT_AREA]>=max(300,cv2.countNonZero(mask)*.12)]
        values=[]
        for i in ids[:6]:
            part=np.uint8(labels==i)*255;contour=max(cv2.findContours(part,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0],key=cv2.contourArea)
            ys,xs=np.where(part>0);points=np.column_stack([xs,ys]).astype(np.float64);eigen=np.linalg.eigvalsh(np.cov(points.T));aspect=float(eigen[0]/max(1e-8,eigen[1]));values.append((contour,aspect))
        return values
    a,b=regions(reference),regions(other)
    for ca,ra in a:
        for cb,rb in b:
            if .5<=rb/max(1e-8,ra)<=2 and cv2.matchShapes(ca,cb,cv2.CONTOURS_MATCH_I1,0)<=.35:return {'compatible':True,'reason':'图库有与参考商品轮廓和长宽分布相容的完整前景区域'}
    return {'compatible':False,'reason':'图库前景可能是局部特写或其他物品，不作为完整主体参考'}

def prepare(encoded, decode, template=False, attention=None):
    key = hashlib.sha256((encoded + str(template) + (attention or '')).encode()).hexdigest()
    if key in CACHE:
        CACHE.move_to_end(key)
        return CACHE[key]
    image, mask = decode(encoded, template, 384 if template else 768)
    if attention:
        raw = base64.b64decode(attention, validate=True)
        if len(raw) != 224*224:
            raise ValueError('invalid instance attention')
        weights = cv2.resize(np.frombuffer(raw, np.uint8).reshape(224,224), (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
        mask = np.where((mask>0)&(weights>=204),255,0).astype(np.uint8)
    regions = [mask] if template else [None]
    if template:
        count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
        eligible = [i for i in range(1,count) if stats[i,cv2.CC_STAT_AREA]>=max(800,cv2.countNonZero(mask)*.12)]
        # Only comparable, repeated foreground subjects are separated. A lone
        # tube logo/cap/hand or an accessory cannot become a product template.
        if 2<=len(eligible)<=6:
            masks=[np.uint8(labels==i)*255 for i in eligible]
            contours=[max(cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0],key=cv2.contourArea) for m in masks]
            hist=[]
            for m in masks:
                h=cv2.calcHist([image],[0,1,2],m,[4,4,4],[0,256]*3).reshape(-1);hist.append(h/max(1,h.sum()))
            areas=[cv2.countNonZero(m) for m in masks]
            similar=all(min(areas)/max(areas)>=.65 and float(np.sqrt(hist[0]*h).sum())>=.90 and cv2.matchShapes(contours[0],c,cv2.CONTOURS_MATCH_I1,0)<=.35 for h,c in zip(hist[1:],contours[1:]))
            if similar:regions += masks[:4]
    detector=cv2.SIFT_create(nfeatures=2400,contrastThreshold=.015)
    gray=cv2.cvtColor(image,cv2.COLOR_BGR2GRAY)
    targets=[]
    for region in regions:
        points,descriptors=detector.detectAndCompute(gray,region)
        targets.append((region,points,descriptors))
    value=(image,targets);CACHE[key]=value
    while len(CACHE)>24:CACHE.popitem(last=False)
    return value

def content_check(a,b,mask,h):
    try:inverse=np.linalg.inv(h)
    except np.linalg.LinAlgError:return None
    aligned=cv2.warpPerspective(b,inverse,(a.shape[1],a.shape[0]))
    visible=cv2.warpPerspective(np.ones(b.shape[:2],np.uint8),inverse,(a.shape[1],a.shape[0]),flags=cv2.INTER_NEAREST)>0
    interior=cv2.erode(mask,np.ones((5,5),np.uint8))>0
    if interior.sum()<200 or float((visible&interior).sum()/interior.sum())<.98:return None
    ys,xs=np.where(mask>0);x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
    delta=np.abs(a.astype(np.float32)-aligned.astype(np.float32)).mean(axis=2)
    mean=float(delta[interior].mean());p90=float(np.percentile(delta[interior],90));local=[]
    for row in range(4):
        for col in range(4):
            top,bottom=y0+row*(y1-y0)//4,y0+(row+1)*(y1-y0)//4;left,right=x0+col*(x1-x0)//4,x0+(col+1)*(x1-x0)//4
            region=interior[top:bottom,left:right]
            if region.sum()>=50:local.append(float(delta[top:bottom,left:right][region].mean()))
    neutral=(a.max(axis=2).astype(np.int16)-a.min(axis=2).astype(np.int16)<12)&(a.mean(axis=2)>125)&interior
    gray=np.abs(cv2.cvtColor(a,cv2.COLOR_BGR2GRAY).astype(np.float32)-cv2.cvtColor(aligned,cv2.COLOR_BGR2GRAY).astype(np.float32));details=[]
    for row in range(8):
        for col in range(8):
            top,bottom=y0+row*(y1-y0)//8,y0+(row+1)*(y1-y0)//8;left,right=x0+col*(x1-x0)//8,x0+(col+1)*(x1-x0)//8
            region=neutral[top:bottom,left:right]
            if region.sum()>=20:details.append(float(gray[top:bottom,left:right][region].mean()))
    worst=max(local,default=255);fine=max(details,default=0)
    return {'colorError':mean,'colorError90':p90,'worstRegionError':worst,'neutralDetailError':fine,'matched':mean<=7 and p90<=16 and worst<=12 and fine<=10}

def compare_instances(template,candidate,decode,attention=None):
    a,targets=prepare(template,decode,True,attention);b,scene=prepare(candidate,decode)
    _,kb,db=scene[0];best={'algorithm':'SIFT-instance','matched':False,'reason':'没有建立完整商品实例对应','inliers':0};attempts=0
    if db is None or len(kb)<24:return best
    matcher=cv2.BFMatcher(cv2.NORM_L2)
    for mirror in [False,True]:
        # Flipping only changes a comparison view, never saved pixels/alpha.
        if mirror:
            flipped=cv2.flip(a,1);detector=cv2.SIFT_create(nfeatures=2400,contrastThreshold=.015)
            current=[(cv2.flip(mask,1),*detector.detectAndCompute(cv2.cvtColor(flipped,cv2.COLOR_BGR2GRAY),cv2.flip(mask,1))) for mask,_,_ in targets];image=flipped
        else:current=targets;image=a
        for target_index,(mask,ka,da) in enumerate(current):
            if da is None or len(ka)<24:continue
            ys,xs=np.where(mask>0);cx,cy=float(xs.mean()),float(ys.mean());proposals=[]
            # Repeated objects give equal nearest neighbours. Collect bounded
            # alternatives, then require one unique, geometrically coherent unit.
            for neighbours in matcher.knnMatch(da,db,k=min(24,len(db))):
                if not neighbours:continue
                limit=min(130,neighbours[0].distance*1.4+20)
                for match in neighbours:
                    if match.distance>limit:break
                    pa,pb=ka[match.queryIdx],kb[match.trainIdx];scale=pb.size/pa.size
                    if not .12<=scale<=5:continue
                    angle=np.radians(pb.angle-pa.angle);u,v=scale*np.cos(angle),scale*np.sin(angle)
                    px=pb.pt[0]+u*(cx-pa.pt[0])-v*(cy-pa.pt[1]);py=pb.pt[1]+v*(cx-pa.pt[0])+u*(cy-pa.pt[1])
                    if -30<=px<=b.shape[1]+30 and -30<=py<=b.shape[0]+30:proposals.append((px,py,scale,angle,match.queryIdx,match.trainIdx,match.distance))
            if len(proposals)<24:continue
            p=np.array(proposals);bins={}
            for i,item in enumerate(p):
                key=(round(item[0]/24),round(item[1]/24),round(np.log(item[2])/.18),round(item[3]/.3));bins.setdefault(key,[]).append(i)
            seeds=sorted(bins.values(),key=len,reverse=True)[:24]
            for group in seeds:
                seed=p[group[0]];radius=max(12,max(image.shape)*seed[2]*.10)
                angular=np.abs(np.arctan2(np.sin(p[:,3]-seed[3]),np.cos(p[:,3]-seed[3])))
                indexes=np.where((np.hypot(p[:,0]-seed[0],p[:,1]-seed[1])<=radius)&(np.abs(np.log(p[:,2]/seed[2]))<=.25)&(angular<=.4))[0]
                used_a,used_b=set(),set();pairs=[]
                for i in sorted(indexes,key=lambda i:p[i,6]):
                    ia,ib=int(p[i,4]),int(p[i,5])
                    if ia not in used_a and ib not in used_b:used_a.add(ia);used_b.add(ib);pairs.append((ia,ib))
                if len(pairs)<24:continue
                attempts+=1;pa=np.float32([ka[i].pt for i,_ in pairs]);pb=np.float32([kb[j].pt for _,j in pairs]);cv2.setRNGSeed(7)
                h,inliers=cv2.findHomography(pa,pb,cv2.RANSAC,2.5)
                if h is None or not np.isfinite(h).all():continue
                inliers=inliers.ravel().astype(bool);points=pa[inliers];count=int(inliers.sum())
                if count<24 or float(inliers.mean())<.75:continue
                x0,x1,y0,y1=xs.min(),xs.max(),ys.min(),ys.max();coverage=float(cv2.contourArea(cv2.convexHull(points))/max(1,(x1-x0)*(y1-y0)))
                rows={min(2,int((y-y0)*3/max(1,y1-y0+1))) for x,y in points};cols={min(2,int((x-x0)*3/max(1,x1-x0+1))) for x,y in points}
                if coverage<.30 or len(rows)<3 or len(cols)<2:continue
                details=content_check(image,b,mask,h)
                if details is None:continue
                result={'algorithm':'SIFT-instance',**details,'inliers':count,'inlierRatio':float(inliers.mean()),'subjectCoverage':coverage,'referenceRegion':target_index,'referenceRegionCount':len(targets),'mirror':mirror,'instanceHypotheses':attempts,'scope':'visible-product-instance','reason':'完整商品实例的几何、颜色和局部内容一致，图片中数量和摆放不作为排除依据' if details['matched'] else '商品实例局部内容尚未确认'}
                if count>best.get('inliers',0):best=result
                if result['matched']:return result
    return best
