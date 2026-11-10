const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const formatTime = value => { const s = Math.max(0, Math.floor(Number(value) || 0)); return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}` : `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`; };
const modeLabel = mode => mode === 'stereo' ? '双目' : '单目';
const video = $('video');
let catalog, samples = [], filtered = [], selected = null, detail = null;
let modality = 'all', activeIndex = -1, request = null, generation = 0, poseView = null, posePending = false;
let videoTick = null, lastPoseDraw = 0, toastTimer, timelineBounds;

function toast(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 2800); }
async function fetchJSON(url, signal) {
  const path = url === '/api/catalog' ? 'catalog.json' : url.replace(/^\/api\/sample\/(\d+)$/, 'derived/$1/detail.json').replace(/^\/api\/pose\/(\d+)$/, 'derived/$1/pose.json.gz');
  const r = await fetch(new URL(path, document.baseURI), {signal});
  if (!r.ok) throw new Error(`读取失败（${r.status}）`);
  if (!path.endsWith('.gz')) return r.json();
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] !== 31 || bytes[1] !== 139) return JSON.parse(new TextDecoder().decode(bytes));
  if (!('DecompressionStream' in window)) throw new Error('请使用支持 gzip 解压的现代浏览器');
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
}

function renderList() {
  const query = $('search').value.trim().toLowerCase();
  filtered = samples.filter(s => (modality === 'all' || s.modality === modality) && `${s.group} ${s.category} ${s.sid}`.toLowerCase().includes(query));
  $('result-count').textContent = `${filtered.length} / ${samples.length}`;
  $('sample-list').innerHTML = filtered.length ? filtered.map(s => `<button type="button" class="sample-card ${selected?.sid === s.sid ? 'selected' : ''}" data-sid="${esc(s.sid)}" aria-pressed="${selected?.sid === s.sid}" aria-label="${esc(s.group)}，${esc(s.subcategory)}，${formatTime(s.durationSec)}"><img class="sample-thumb" src="${esc(s.poster)}" alt="" loading="lazy" decoding="async" width="54" height="46"><span class="sample-card-text"><span class="sample-card-top"><strong>${esc(s.group)}</strong><span>${formatTime(s.durationSec)}</span></span><span class="sample-card-bottom"><span class="sample-subcategory">${esc(s.subcategory)}</span><span class="mini-dot"></span><span class="mode-badge">${modeLabel(s.modality)}</span></span></span></button>`).join('') : '<p class="empty-note">没有匹配的场景。<br>试试其他关键词或采集模态。</p>';
  updateNavigation();
}

function updateNavigation() {
  const index = filtered.findIndex(s => s.sid === selected?.sid);
  $('previous').disabled = index <= 0;
  $('next').disabled = index < 0 || index >= filtered.length - 1;
  const ordinal = samples.findIndex(s => s.sid === selected?.sid);
  $('position-label').textContent = `${String(ordinal + 1).padStart(2,'0')} / ${samples.length}`;
}

function setTab(name) {
  document.querySelectorAll('[data-tab]').forEach(el => { const on = el.dataset.tab === name; el.setAttribute('aria-selected', String(on)); el.tabIndex = on ? 0 : -1; });
  $('panel-actions').hidden = name !== 'actions'; $('panel-info').hidden = name !== 'info';
}

async function selectSample(sid, updateHash = true) {
  const sample = samples.find(s => s.sid === String(sid)); if (!sample) return;
  const turn = ++generation;
  request?.abort(); request = new AbortController();
  selected = sample; detail = null; activeIndex = -1;
  stopVideoTick(); video.pause(); poseView?.destroy(); poseView = null; posePending = false;
  $('pose-content').hidden = true; $('pose-intro').hidden = false;
  $('toggle-pose').textContent = '加载三维视图 ↗'; $('toggle-pose').disabled = !sample.hasPose;
  $('toggle-pose').setAttribute('aria-expanded', 'false');
  $('sample-workbench').setAttribute('aria-busy', 'true');
  $('group-label').textContent = sample.group; $('subcategory-label').textContent = sample.subcategory;
  $('sample-title').textContent = sample.subcategory; $('sample-sid').textContent = sample.sid;
  const intr = sample.intrinsics || {};
  $('sample-facts').innerHTML = `<span class="primary">${modeLabel(sample.modality)}采集</span><span>${formatTime(sample.durationSec)} 完整片段</span><span>标注 ${sample.fps?.toFixed(2) ?? '—'} fps</span><span id="video-resolution">正在读取画质</span><span>${sample.actionCount} 条动作</span>`;
  $('playback-time').textContent = `00:00 / ${formatTime(sample.durationSec)}`;
  $('current-action').textContent = '播放视频，查看对应动作';
  $('timeline-middle').textContent = formatTime(sample.durationSec / 2); $('timeline-end').textContent = formatTime(sample.durationSec);
  $('timeline-track').setAttribute('aria-valuemax', String(sample.durationSec));
  $('playhead').style.left = '0%'; $('video-error').hidden = true;
  video.poster = sample.poster;
  const channelLabel = v => v.displayLabel || (v.name === 'video_left.mp4' ? '主画面' : v.name.includes('right') ? '右目骨架' : v.name.includes('overlay') ? '左目骨架' : v.label || v.name);
  $('channel-tabs').innerHTML = sample.videos.map((v, i) => `<button type="button" data-video="${esc(v.name)}" class="${i === 0 ? 'active' : ''}" aria-pressed="${i === 0}">${esc(channelLabel(v))}</button>`).join('');
  if (sample.videos.length) { video.src = `./media/${sample.sid}/${encodeURIComponent(sample.videos[0].name)}`; video.load(); }
  else { video.removeAttribute('src'); video.load(); $('video-error').textContent = '该样本的视频尚未准备完成。'; $('video-error').hidden = false; }
  $('action-count').textContent = sample.actionCount;
  $('actions-list').innerHTML = '<p class="loading-note">正在读取标注…</p>';
  $('event-title').textContent = sample.subcategory; $('event-description').textContent = '正在读取任务语义。';
  $('info-content').innerHTML = '<p class="loading-note">正在读取样本信息…</p>';
  setTab('actions'); renderList(); drawTimeline();
  if (updateHash) history.replaceState(null, '', `#sample/${sample.sid}`);
  try {
    const data = await fetchJSON(`/api/sample/${sample.sid}`, request.signal);
    if (turn !== generation) return;
    detail = data;
    renderActions(); renderInfo(); drawTimeline(); syncPlayback();
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('actions-list').innerHTML = `<p class="empty-note">${esc(error.message)}。<br>可重新选择此样本重试。</p>`;
    $('event-description').textContent = '标注暂时无法读取。';
  } finally { if (turn === generation) $('sample-workbench').setAttribute('aria-busy', 'false'); }
}

function renderActions() {
  const actions = detail.actions || [], event = detail.events?.[0];
  $('event-title').textContent = event?.title || selected.subcategory;
  $('event-description').textContent = event?.description || '该片段提供按时间段排列的操作标注，可点击任意动作跳转视频。';
  $('actions-list').innerHTML = actions.length ? actions.map((a,i) => `<button type="button" class="action-row" data-action="${i}" title="${formatTime(a.start_time)}–${formatTime(a.end_time)}"><span class="time">${formatTime(a.start_time)}</span><span class="action-text">${esc(a.text)}</span></button>`).join('') : '<p class="empty-note">该片段没有动作文字标注。</p>';
  $('actions-list').scrollTop = 0;
}

function renderInfo() {
  const s = selected, q = detail.quality || {}, valid = q.validFramePct || {};
  const sourceSection = s.sourceVideos?.length ? `<section class="info-section"><h3>来源视频 · 保留原编码</h3><p>所选时间窗的来源播放器视频。画质依源服务实际返回；H.265 文件建议下载后用本地播放器打开。</p><div class="data-links">${s.sourceVideos.map(v => `<a href="${esc(v.downloadUrl)}" download>${v.side === 'right' ? '右目' : '左目'} · ${v.width}×${v.height} · ${esc(v.codec || '')}<span>${(v.bytes / 1048576).toFixed(1)} MB ↓</span></a>`).join('')}</div></section>` : '';

  const row = (key, val) => `<div class="info-row"><span>${esc(key)}</span><span>${esc(val)}</span></div>`;
  $('info-content').innerHTML = `<section class="info-section"><h3>样本信息</h3>${row('业务大类',s.group)}${row('原始细分类',s.subcategory)}${row('采集模态',modeLabel(s.modality))}${row('片段时长',`${s.durationSec.toFixed(2)} 秒`)}${row('类内中位数',`${s.medianDurationSec.toFixed(2)} 秒`)}${row('帧数',s.nframes?.toLocaleString() ?? '—')}${row('源视频区间',`${formatTime(s.sourceStartSec)}–${formatTime(s.sourceEndSec)}`)}</section><section class="info-section"><h3>标注与几何</h3>${row('动作 / 事件',`${s.actionCount} / ${s.eventCount}`)}${row('手部关节','每只手 21 个三维关节')}${row('左手有效帧',valid.left == null ? '未提供' : `${valid.left}%`)}${row('右手有效帧',valid.right == null ? '未提供' : `${valid.right}%`)}${row('手部真值',q.handGroundTruth ? '源接口标记有' : '未提供真值验证')}<p>有效帧比例表示字段完整性，不代表几何准确率。主画面可能与左目骨架通道为同一源文件；当前保留源服务实际交付内容。</p></section><section class="info-section"><h3>完整标注下载</h3><p>下载这条片段的完整动作标注、标定参数与完整帧率几何数组。</p><div class="data-links"><a href="raw/${s.sid}/annotations.json" download>动作与事件标注 · JSON <span>↓</span></a><a href="raw/${s.sid}/manifest.json" download>样本参数与标定 · JSON <span>↓</span></a>${s.hasPose ? `<a href="raw/${s.sid}/world.json.gz" download>完整三维数据 · JSON.GZ <span>↓</span></a>` : ''}</div></section>${sourceSection}`;
}

function drawTimeline() {
  const canvas = $('timeline-canvas'), rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(rect.width*dpr); canvas.height = Math.round(rect.height*dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr); ctx.clearRect(0,0,rect.width,rect.height);
  timelineBounds = rect;
  if (!selected || !detail) return;
  for (let i=0;i<detail.actions.length;i++) {
    const a = detail.actions[i], x = Math.max(0,a.start_time) / selected.durationSec * rect.width;
    const width = Math.max(1,(Math.min(selected.durationSec,a.end_time)-Math.max(0,a.start_time))/selected.durationSec*rect.width);
    ctx.fillStyle = i % 2 ? '#a8c7a6' : '#c2d6b8'; ctx.fillRect(x,5,width,14);
  }
}

function seek(time) {
  if (!selected) return;
  const target = Math.min(Math.max(0,time), Math.max(0,selected.durationSec-.05));
  if (video.readyState >= 1) video.currentTime = target;
  else { const turn=generation; video.addEventListener('loadedmetadata',() => { if(turn===generation) video.currentTime=target; },{once:true}); }
  syncPlayback(target);
}

function syncPlayback(forcedTime) {
  if (!selected) return;
  const t = typeof forcedTime === 'number' ? forcedTime : video.currentTime || 0;
  $('playback-time').textContent = `${formatTime(t)} / ${formatTime(selected.durationSec)}`;
  $('playhead').style.left = `${Math.min(100, t / selected.durationSec * 100)}%`;
  $('timeline-track').setAttribute('aria-valuenow', t.toFixed(1));
  $('timeline-track').setAttribute('aria-valuetext', formatTime(t));
  if (detail) {
    const index = detail.actions.findIndex(a => t >= a.start_time && t < a.end_time);
    if (index !== activeIndex) {
      const old = $('actions-list').querySelector('.active'); old?.classList.remove('active'); old?.removeAttribute('aria-current');
      const current = $('actions-list').querySelector(`[data-action="${index}"]`);
      current?.classList.add('active'); current?.setAttribute('aria-current','true');
      activeIndex = index;
      $('current-action').textContent = index >= 0 ? detail.actions[index].text : (t > 0 ? '当前区间无动作文字标注' : '播放视频，查看对应动作');
      if (current && $('follow-actions').checked && !$('panel-actions').hidden) {
        const list = $('actions-list'), box=current.getBoundingClientRect(), parent=list.getBoundingClientRect();
        if(box.top < parent.top || box.bottom > parent.bottom) list.scrollTo({top:list.scrollTop+box.top-parent.top-list.clientHeight*.35,behavior:'auto'});
      }
    }
  }
  if (poseView && !$('pose-content').hidden) poseView.update(t);
}

function stopVideoTick(){ if(videoTick!==null) cancelAnimationFrame(videoTick); videoTick=null; }
function scheduleVideoTick(){
  stopVideoTick();
  const tick = now => { if(video.paused || video.ended || document.hidden || !poseView || $('pose-content').hidden){videoTick=null;return;} if(now-lastPoseDraw>90){poseView.update(video.currentTime);lastPoseDraw=now;} videoTick=requestAnimationFrame(tick); };
  if(!video.paused && poseView && !$('pose-content').hidden && !document.hidden) videoTick=requestAnimationFrame(tick);
}

async function togglePose() {
  if (!selected?.hasPose || posePending) return;
  if(poseView){const show=$('pose-content').hidden;$('pose-content').hidden=!show;$('pose-intro').hidden=show;$('toggle-pose').textContent=show?'收起三维视图 ↑':'展开三维视图 ↗';$('toggle-pose').setAttribute('aria-expanded',String(show));if(show){poseView.resize();poseView.update(video.currentTime);scheduleVideoTick();}else stopVideoTick();return;}
  const turn=generation; posePending=true;$('toggle-pose').disabled=true;$('toggle-pose').textContent='正在读取姿态…';
  try {
    const [module,data] = await Promise.all([import('./viewer.js'),fetchJSON(`/api/pose/${selected.sid}`,request.signal)]);
    if(turn!==generation) return;
    $('pose-content').hidden=false;$('pose-intro').hidden=true;
    poseView=module.createPoseViewer($('hand-canvas'),$('camera-canvas'),data);
    poseView.update(video.currentTime);
    $('pose-note').textContent=`展示视图约 ${(data.fps/data.stride).toFixed(1)} fps，完整帧率原数据可在数据详情下载。几何为估计值，坐标尺度与精度未独立验证。`;
    $('toggle-pose').textContent='收起三维视图 ↑';$('toggle-pose').setAttribute('aria-expanded','true');scheduleVideoTick();
  } catch(error){ if(error.name!=='AbortError'){toast('三维数据加载失败，可再次点击重试');$('toggle-pose').textContent='重新加载三维视图 ↗';} }
  finally {if(turn===generation){posePending=false;$('toggle-pose').disabled=false;}}
}

$('sample-list').addEventListener('click',event=>{const button=event.target.closest('[data-sid]');if(button)selectSample(button.dataset.sid);});
$('search').addEventListener('input',renderList);
document.querySelectorAll('[data-modality]').forEach(button=>button.addEventListener('click',()=>{modality=button.dataset.modality;document.querySelectorAll('[data-modality]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});renderList();}));
document.querySelectorAll('[data-tab]').forEach(button=>{button.addEventListener('click',()=>setTab(button.dataset.tab));button.addEventListener('keydown',event=>{if(['ArrowRight','ArrowLeft'].includes(event.key)){event.preventDefault();const tab=button.dataset.tab==='actions'?'info':'actions';setTab(tab);$(`tab-${tab}`).focus();}});});
$('actions-list').addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(b && detail)seek(detail.actions[Number(b.dataset.action)].start_time);});
$('timeline-track').addEventListener('pointerdown',event=>{if(!selected)return;const rect=$('timeline-track').getBoundingClientRect();seek((event.clientX-rect.left)/rect.width*selected.durationSec);});
$('timeline-track').addEventListener('keydown',event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();seek(video.currentTime+(event.key==='ArrowRight'?5:-5));}});
$('channel-tabs').addEventListener('click',event=>{
  const b=event.target.closest('[data-video]');if(!b || b.classList.contains('active'))return;
  const time=video.currentTime, wasPlaying=!video.paused, turn=generation;
  document.querySelectorAll('[data-video]').forEach(el=>{el.classList.toggle('active',el===b);el.setAttribute('aria-pressed',String(el===b));});
  video.pause();$('video-error').hidden=true;video.src=`./media/${selected.sid}/${encodeURIComponent(b.dataset.video)}`;video.load();
  video.addEventListener('loadedmetadata',()=>{if(turn!==generation)return;video.currentTime=Math.min(time,video.duration || time);if(wasPlaying)video.play().catch(()=>{});},{once:true});
});
for(const name of ['timeupdate','seeked','loadedmetadata'])video.addEventListener(name,()=>syncPlayback());
video.addEventListener('loadedmetadata',()=>{if($('video-resolution'))$('video-resolution').textContent=`播放 ${video.videoWidth} × ${video.videoHeight}`;});
video.addEventListener('play',scheduleVideoTick);video.addEventListener('pause',()=>{stopVideoTick();syncPlayback();});video.addEventListener('ended',stopVideoTick);
video.addEventListener('error',()=>{if(!video.getAttribute('src'))return;$('video-error').textContent='视频暂时无法播放。请确认下载已完成，并尝试切换通道。';$('video-error').hidden=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopVideoTick();else scheduleVideoTick();});
$('toggle-pose').addEventListener('click',togglePose);$('reset-view').addEventListener('click',()=>poseView?.reset());
for(const [id,step] of [['previous',-1],['next',1]])$(id).addEventListener('click',()=>{const index=filtered.findIndex(s=>s.sid===selected?.sid);const next=filtered[index+step];if(next)selectSample(next.sid);});
$('export-csv').addEventListener('click',()=>{
  const quote=v=>`"${String(v??'').replace(/"/g,'""')}"`;
  const rows=[['业务大类','细分类','片段编号','模态','时长秒','动作条数','源任务编号'],...samples.map(s=>[s.group,s.subcategory,s.sid,modeLabel(s.modality),s.durationSec.toFixed(3),s.actionCount,s.taskId])];
  const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(row=>row.map(quote).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='具身数据_14类样本清单.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`已导出 ${samples.length} 个样本的清单`);
});
new ResizeObserver(drawTimeline).observe($('timeline-track'));
window.addEventListener('hashchange',()=>{const sid=location.hash.match(/^#sample\/(\d+)$/)?.[1];if(sid && sid!==selected?.sid)selectSample(sid,false);});

try {
  catalog=await fetchJSON('/api/catalog');samples=catalog.samples;
  if(!samples.length)throw new Error('样本数据尚未准备完成，请稍后刷新');
  $('stat-count').innerHTML=`${samples.length}<span>类</span>`;
  $('stat-time').textContent=formatTime(catalog.totalDurationSec);
  $('stat-actions').textContent=samples.reduce((sum,s)=>sum+s.actionCount,0).toLocaleString();
  const sid=location.hash.match(/^#sample\/(\d+)$/)?.[1];
  await selectSample(samples.some(s=>s.sid===sid)?sid:samples[0].sid);
} catch(error){$('fatal-error').textContent=`数据加载失败：${error.message}。请刷新页面，或稍后重试。`;$('fatal-error').hidden=false;$('sample-title').textContent='数据尚未就绪';$('sample-workbench').setAttribute('aria-busy','false');}
