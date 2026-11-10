// A small canvas renderer for real pose arrays. No external graphics dependencies.
export function createPoseViewer(handCanvas,cameraCanvas,data){
  let yaw=-.3,pitch=.28,zoom=1,time=0,destroyed=false,dragging=false,lastX=0,lastY=0;
  const abort=new AbortController(),signal=abort.signal;
  let handSize=[1,1],cameraSize=[1,1],cameraPath=[];
  const cameras=data.camera.filter(p=>p && p.every(Number.isFinite));
  const extent=axis=>cameras.length?[Math.min(...cameras.map(p=>p[axis])),Math.max(...cameras.map(p=>p[axis]))]:[0,1];
  const xExtent=extent(0),zExtent=extent(2);
  const ccenter=[(xExtent[0]+xExtent[1])/2,(zExtent[0]+zExtent[1])/2];
  const cspan=Math.max(xExtent[1]-xExtent[0],zExtent[1]-zExtent[0],.05);
  const setup=canvas=>{const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return [rect.width,rect.height];};
  const resize=()=>{if(destroyed)return;handSize=setup(handCanvas);cameraSize=setup(cameraCanvas);const [w,h]=cameraSize;cameraPath=data.camera.map(p=>p?[(p[0]-ccenter[0])/cspan*Math.min(w,h)*.72+w/2,(p[2]-ccenter[1])/cspan*Math.min(w,h)*.72+h/2]:null);draw();};
  const index=()=>Math.min(data.times.length-1,Math.max(0,Math.round(time*data.fps/data.stride)));
  function draw(){
    if(destroyed)return;
    const [w,h]=handSize,ctx=handCanvas.getContext('2d');ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='#e1e9db';ctx.lineWidth=.6;
    for(let x=12;x<w;x+=24){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
    for(let y=12;y<h;y+=24){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    const i=index(),left=data.left[i],right=data.right[i];
    const points=[...(left||[]),...(right||[])].filter(p=>p && p.every(Number.isFinite));
    if(!points.length){ctx.fillStyle='#879780';ctx.font='11px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillText('当前帧没有有效的手部姿态',w/2,h/2);drawCamera(i);return;}
    const min=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1,2].map(k=>Math.max(...points.map(p=>p[k])));
    const center=min.map((v,k)=>(v+max[k])/2),span=Math.max(...min.map((v,k)=>max[k]-v),.15);
    const scale=Math.min(w,h)*.72/span*zoom;
    const project=p=>{const x=p[0]-center[0],y=p[1]-center[1],z=p[2]-center[2];const rx=x*Math.cos(yaw)-z*Math.sin(yaw),rz=x*Math.sin(yaw)+z*Math.cos(yaw);const ry=y*Math.cos(pitch)-rz*Math.sin(pitch);return [w/2+rx*scale,h*.47+ry*scale];};
    for(const [joints,color] of [[left,'#178a75'],[right,'#d39645']]){
      if(!joints)continue;const projected=joints.map(p=>p && p.every(Number.isFinite)?project(p):null);
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1.8;ctx.lineCap='round';
      for(const [a,b] of data.connections){const p=projected[a],q=projected[b];if(!p||!q)continue;ctx.beginPath();ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();}
      projected.forEach((p,j)=>{if(!p)return;ctx.beginPath();ctx.arc(p[0],p[1],j===0?3.8:2.1,0,Math.PI*2);ctx.fill();});
    }
    ctx.font='8px Consolas,monospace';ctx.textAlign='left';ctx.fillStyle='#8a9982';ctx.fillText(`FRAME ${Math.min(data.nframes-1,Math.round(time*data.fps))} / ${data.nframes}`,10,15);
    drawCamera(i);
  }
  function drawCamera(i){
    const ctx=cameraCanvas.getContext('2d'),[w,h]=cameraSize;ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='#dce5d5';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(w/2,18);ctx.lineTo(w/2,h-28);ctx.moveTo(12,h/2);ctx.lineTo(w-12,h/2);ctx.stroke();
    ctx.strokeStyle='#b9cdb1';ctx.lineWidth=1.2;ctx.beginPath();let started=false;
    for(const p of cameraPath){if(!p){started=false;continue;}if(!started){ctx.moveTo(...p);started=true;}else ctx.lineTo(...p);}ctx.stroke();
    ctx.strokeStyle='#698e60';ctx.lineWidth=1.4;ctx.beginPath();started=false;
    for(let j=0;j<=i;j++){const p=cameraPath[j];if(!p){started=false;continue;}if(!started){ctx.moveTo(...p);started=true;}else ctx.lineTo(...p);}ctx.stroke();
    const p=cameraPath[i];if(p){ctx.fillStyle='#176c57';ctx.beginPath();ctx.arc(p[0],p[1],4,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}
  }
  handCanvas.addEventListener('pointerdown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;handCanvas.setPointerCapture(e.pointerId);},{signal});
  handCanvas.addEventListener('pointermove',e=>{if(!dragging)return;yaw+=(e.clientX-lastX)*.012;pitch=Math.min(1.5,Math.max(-1.5,pitch+(e.clientY-lastY)*.012));lastX=e.clientX;lastY=e.clientY;draw();},{signal});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])handCanvas.addEventListener(event,()=>dragging=false,{signal});
  handCanvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.min(2.5,Math.max(.4,zoom*(e.deltaY>0?.9:1.1)));draw();},{passive:false,signal});
  handCanvas.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;if(e.key==='ArrowUp')pitch-=.12;if(e.key==='ArrowDown')pitch+=.12;draw();}},{signal});
  const observer=new ResizeObserver(resize);observer.observe(handCanvas);observer.observe(cameraCanvas);resize();
  return {update(t){time=t;draw();},resize,reset(){yaw=-.3;pitch=.28;zoom=1;draw();},destroy(){destroyed=true;observer.disconnect();abort.abort();}};
}
