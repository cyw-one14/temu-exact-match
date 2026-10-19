// Image processors also return plain size/shape metadata that models ignore.
// Preserve those values; only Tensor objects need reconstruction across threads.
export function serializeTensors(values){return Object.fromEntries(Object.entries(values).map(([key,value])=>{
  const data=value?.data,type=value?.type,dims=value?.dims;
  return [key,typeof type==='string'&&Array.isArray(dims)&&data!==undefined?{tensor:true,type,dims,data}:{tensor:false,value}];
}));}
export function deserializeTensors(values,Tensor){return Object.fromEntries(Object.entries(values).map(([key,row])=>[key,row.tensor===false?row.value:new Tensor(row.type,row.data,row.dims)]));}
