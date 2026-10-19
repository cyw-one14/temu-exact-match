// Explicitly synthetic transport test; never loads a model or real query.
process.once('disconnect',()=>process.exit(0));
process.on('message',message=>{
  if(message.operation==='prepare'){process.send({id:message.id,ok:true,value:null});return;}
  const started=Date.now();Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,180);
  process.send({id:message.id,ok:true,value:{...message.inputs,pid:{tensor:false,value:process.pid},started:{tensor:false,value:started},finished:{tensor:false,value:Date.now()}}});
});
