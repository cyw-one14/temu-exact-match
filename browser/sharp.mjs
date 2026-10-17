// Implements only the image operations used by the existing subject pipeline.
// Original encoded input bytes are never mutated; operations work on separate canvases.
function canvas(width,height){return new OffscreenCanvas(Math.max(1,Math.round(width)),Math.max(1,Math.round(height)));}
function background(context,color){context.fillStyle=color||'#fff';context.fillRect(0,0,context.canvas.width,context.canvas.height);}
export default function sharp(input,options={}){return new BrowserImage(input,options);}
class BrowserImage{
  constructor(input,options){this.input=input;this.options=options;this.operations=[];this.channels=options.raw?.channels||4;this.output='png';}
  rotate(angle,options={}){if(angle!==undefined)this.operations.push(['rotate',angle,options]);return this;}
  resize(width,height,options={}){this.operations.push(['resize',width,height,options]);return this;}
  extract(bounds){this.operations.push(['extract',bounds]);return this;}
  flop(){this.operations.push(['flop']);return this;}
  flatten(options={}){this.operations.push(['flatten',options.background||'#fff']);this.channels=3;return this;}
  removeAlpha(){this.channels=3;return this;}
  ensureAlpha(){this.channels=4;return this;}
  greyscale(){this.channels=1;return this;}
  toColourspace(){return this;}
  raw(){this.output='raw';return this;}
  png(){this.output='png';return this;}
  async decode(){
    if(this.decoded)return this.decoded;
    if(this.options.raw){const {width,height,channels}=this.options.raw;if(width*height>40000000)throw Error('图片像素过大');const rgba=new Uint8ClampedArray(width*height*4);for(let i=0;i<width*height;i++){for(let c=0;c<3;c++)rgba[i*4+c]=this.input[i*channels+(channels===1?0:c)];rgba[i*4+3]=channels===4?this.input[i*4+3]:255;}const result=canvas(width,height);result.getContext('2d').putImageData(new ImageData(rgba,width,height),0,0);return this.decoded=result;}
    const image=await createImageBitmap(new Blob([this.input]));
    if(image.width*image.height>40000000){image.close();throw Error('图片像素过大');}
    const result=canvas(image.width,image.height);result.getContext('2d').drawImage(image,0,0);image.close();return this.decoded=result;
  }
  async metadata(){const image=await this.decode();return {width:image.width,height:image.height,orientation:1,channels:this.channels,hasAlpha:this.channels===4};}
  async render(){
    let current=await this.decode();
    for(const [kind,a,b,c]of this.operations){
      let next,context;
      if(kind==='resize'){
        let width=a||Math.round(current.width*b/current.height),height=b||Math.round(current.height*a/current.width);const options=c;
        const fit=options.fit||'cover';let scale=fit==='cover'?Math.max(width/current.width,height/current.height):Math.min(width/current.width,height/current.height);
        if(options.withoutEnlargement)scale=Math.min(1,scale);
        const w=Math.max(1,Math.round(current.width*scale)),h=Math.max(1,Math.round(current.height*scale));
        if(fit==='inside'){width=w;height=h;}
        next=canvas(width,height);context=next.getContext('2d');if(options.background)background(context,options.background);context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(current,(next.width-w)/2,(next.height-h)/2,w,h);
      }else if(kind==='extract'){next=canvas(a.width,a.height);next.getContext('2d').drawImage(current,a.left,a.top,a.width,a.height,0,0,a.width,a.height);}
      else if(kind==='flop'){next=canvas(current.width,current.height);context=next.getContext('2d');context.translate(next.width,0);context.scale(-1,1);context.drawImage(current,0,0);}
      else if(kind==='flatten'){next=canvas(current.width,current.height);context=next.getContext('2d');background(context,a);context.drawImage(current,0,0);}
      else if(kind==='rotate'){const angle=a*Math.PI/180,co=Math.abs(Math.cos(angle)),si=Math.abs(Math.sin(angle));next=canvas(Math.ceil(current.width*co+current.height*si-1e-8),Math.ceil(current.width*si+current.height*co-1e-8));context=next.getContext('2d');if(b.background)background(context,b.background);context.translate(next.width/2,next.height/2);context.rotate(angle);context.drawImage(current,-current.width/2,-current.height/2);}
      current=next;
    }
    return current;
  }
  async toBuffer({resolveWithObject=false}={}){
    const image=await this.render();let data;
    if(this.output==='png')data=Buffer.from(await(await image.convertToBlob({type:'image/png'})).arrayBuffer());
    else{const rgba=image.getContext('2d').getImageData(0,0,image.width,image.height).data;data=Buffer.alloc(image.width*image.height*this.channels);for(let i=0;i<image.width*image.height;i++)if(this.channels===1)data[i]=Math.round(.2126*rgba[i*4]+.7152*rgba[i*4+1]+.0722*rgba[i*4+2]);else for(let c=0;c<this.channels;c++)data[i*this.channels+c]=rgba[i*4+c];}
    return resolveWithObject?{data,info:{width:image.width,height:image.height,channels:this.channels}}:data;
  }
}
