const DB='twk-gallery-db',VERSION=3,MEDIA='media',ALBUMS='albums',TRASH='trash';
let db,items=[],albums=[],trash=[],view='all',activeAlbum=null,activeId=null,selected=new Set(),sortMode='newest',selectionMode=false,slideTimer=null;
let editorSource=null,editorImage=null,editorRotation=0,editorCrop={x:0,y:0,w:1,h:1},editorHistory=[],editorHistoryIndex=-1,editorDragging=false,editorDragStart=null;
const $=id=>document.getElementById(id),uid=()=>crypto.randomUUID();
function toast(s){const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2500)}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{const d=r.result;if(!d.objectStoreNames.contains(MEDIA)){const s=d.createObjectStore(MEDIA,{keyPath:'id'});s.createIndex('created','created')}if(!d.objectStoreNames.contains(ALBUMS))d.createObjectStore(ALBUMS,{keyPath:'id'});if(!d.objectStoreNames.contains(TRASH))d.createObjectStore(TRASH,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function req(store,mode,method,value){return new Promise((res,rej)=>{const r=db.transaction(store,mode).objectStore(store)[method](...(value===undefined?[]:[value]));r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function load(){[items,albums,trash]=await Promise.all([req(MEDIA,'readonly','getAll'),req(ALBUMS,'readonly','getAll'),req(TRASH,'readonly','getAll')]);const cutoff=Date.now()-30*86400000;for(const x of trash.filter(x=>x.deletedAt<cutoff))await req(TRASH,'readwrite','delete',x.id);trash=trash.filter(x=>x.deletedAt>=cutoff);items.sort((a,b)=>sortMode==='oldest'?a.created-b.created:b.created-a.created);render()}
function currentList(){const q=$('search').value.trim().toLowerCase();let source=view==='trash'?trash:items;return source.filter(x=>(view==='all'||(view==='photos'&&x.type==='image')||(view==='videos'&&x.type==='video')||(view==='favorites'&&x.favorite)||(view==='albums'&&activeAlbum&&x.album===activeAlbum)||view==='trash')&&(!q||x.name.toLowerCase().includes(q)||new Date(x.created).toLocaleDateString().toLowerCase().includes(q)))}
function render(){const list=currentList(),grid=$('grid');$('count').textContent=`${list.length} ${list.length===1?'item':'items'}`;grid.innerHTML='';$('albumTools').hidden=view!=='albums';$('manageTools').hidden=view==='trash'||(view==='albums'&&!!activeAlbum);$('selectionBar').hidden=selected.size===0;$('selectedCount').textContent=`${selected.size} selected`;
if(view==='albums'&&!activeAlbum){renderAlbums();return}
$('empty').hidden=list.length>0;if(!list.length){$('emptyTitle').textContent=view==='trash'?'Recently deleted is empty':'Nothing here yet';$('emptyText').textContent=view==='trash'?'Deleted items stay here for up to 30 days.':'Add photos and videos to your private gallery.';$('emptyAdd').hidden=view==='trash'}
for(const x of list){const b=document.createElement('button');b.className='tile'+(selected.has(x.id)?' chosen':'');const im=document.createElement('img');im.src=URL.createObjectURL(x.blob);im.alt=x.name;b.append(im);if(x.type==='video'){const m=document.createElement('span');m.className='video-mark';m.textContent='▶';b.append(m)}if(x.favorite&&view!=='trash'){const h=document.createElement('span');h.className='heart';h.textContent='♥';b.append(h)}if(selected.has(x.id)){const c=document.createElement('span');c.className='selected-mark';c.textContent='✓';b.append(c)}if(view==='trash'){b.onclick=()=>trashActions(x)}else b.onclick=()=>selectionMode||selected.size?(selected.has(x.id)?selected.delete(x.id):selected.add(x.id),render()):openViewer(x.id);grid.append(b)}
}
function renderAlbums(){const grid=$('grid');grid.innerHTML='';for(const a of albums){const b=document.createElement('button');b.className='album-card';const cover=items.find(x=>x.id===a.coverId)||items.find(x=>x.album===a.id);if(cover){const im=document.createElement('img');im.src=URL.createObjectURL(cover.blob);b.append(im);const badge=document.createElement('small');badge.className='cover-label';badge.textContent='COVER';b.append(badge)}const t=document.createElement('span');t.innerHTML='<strong></strong><small></small>';t.querySelector('strong').textContent=a.name;t.querySelector('small').textContent=items.filter(x=>x.album===a.id).length+' items';b.append(t);const ar=document.createElement('span');ar.textContent='›';b.append(ar);b.onclick=()=>{activeAlbum=a.id;render()};grid.append(b)}
$('albumTools').innerHTML='<button class="pill" id="newAlbum">＋ New album</button>'; $('newAlbum').onclick=()=>albumDialog()}
function albumDialog(id){$('albumName').value=id?albums.find(a=>a.id===id)?.name||'':'';$('modalTitle').textContent=id?'Rename album':'New album';$('saveAlbum').textContent=id?'Save':'Create';$('modal').hidden=false;$('saveAlbum').onclick=async()=>{const name=$('albumName').value.trim();if(!name)return toast('Enter an album name');if(id){const a=albums.find(a=>a.id===id);a.name=name;await req(ALBUMS,'readwrite','put',a)}else await req(ALBUMS,'readwrite','put',{id:uid(),name,created:Date.now()});$('modal').hidden=true;await load()};$('albumName').focus()}
async function moveToTrash(x){await req(MEDIA,'readwrite','delete',x.id);await req(TRASH,'readwrite','put',{...x,deletedAt:Date.now()})}
async function restoreTrash(x){const {deletedAt,...item}=x;await req(MEDIA,'readwrite','put',item);await req(TRASH,'readwrite','delete',x.id);await load();toast('Item restored')}
async function trashActions(x){const action=prompt(`1. Restore "${x.name}"\n2. Permanently delete`);if(action==='1')await restoreTrash(x);else if(action==='2'&&confirm('Permanently delete this item?')){await req(TRASH,'readwrite','delete',x.id);await load();toast('Permanently deleted')}}
function openViewer(id){activeId=id;renderViewer()}
function renderViewer(){const x=items.find(a=>a.id===activeId);if(!x)return;const stage=$('viewerStage');stage.innerHTML='';$('viewerInfo').textContent=x.name;const url=URL.createObjectURL(x.blob),el=document.createElement(x.type==='video'?'video':'img');el.src=url;if(x.type==='video'){el.controls=true;el.playsInline=true}else{el.alt=x.name;el.draggable=false;let scale=1,dist=0;el.style.touchAction='none';el.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(1,Math.min(5,scale+(e.deltaY<0?.25:-.25)));el.style.transform=`scale(${scale})`},{passive:false});el.addEventListener('touchstart',e=>{if(e.touches.length===2)dist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY)},{passive:true});el.addEventListener('touchmove',e=>{if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(dist)scale=Math.max(1,Math.min(5,scale*d/dist));dist=d;el.style.transform=`scale(${scale})`}},{passive:true})}stage.append(el);$('favoriteBtn').textContent=x.favorite?'♥ Favorited':'♡ Favorite';$('editBtn').hidden=x.type!=='image';$('coverBtn').hidden=x.type!=='image';$('viewerMeta').textContent=`${x.blob.type||x.type} · ${formatBytes(x.blob.size)} · ${new Date(x.created).toLocaleString()}`;$('viewer').hidden=false}
function formatBytes(n){if(!n)return'0 B';const u=['B','KB','MB','GB'],i=Math.min(Math.floor(Math.log(n)/Math.log(1024)),3);return`${(n/1024**i).toFixed(i?1:0)} ${u[i]}`}

function closeViewer(){$('viewer').hidden=true;$('viewerStage').innerHTML='';activeId=null}
function editorState(){return{rotation:editorRotation,brightness:$('brightness').value,contrast:$('contrast').value,ratio:$('cropRatio').value,filter:$('photoFilter').value,crop:{...editorCrop}}}
function applyEditorState(s){editorRotation=s.rotation;$('brightness').value=s.brightness;$('contrast').value=s.contrast;$('cropRatio').value=s.ratio;$('photoFilter').value=s.filter;editorCrop={...s.crop};$('brightnessValue').textContent=s.brightness+'%';$('contrastValue').textContent=s.contrast+'%';drawEditorPreview();updateEditorHistoryButtons()}
function pushEditorHistory(){const s=editorState();editorHistory=editorHistory.slice(0,editorHistoryIndex+1);editorHistory.push(s);if(editorHistory.length>40)editorHistory.shift();editorHistoryIndex=editorHistory.length-1;updateEditorHistoryButtons()}
function updateEditorHistoryButtons(){$('undoEdit').disabled=editorHistoryIndex<=0;$('redoEdit').disabled=editorHistoryIndex>=editorHistory.length-1}
function undoEditor(){if(editorHistoryIndex>0){editorHistoryIndex--;applyEditorState(editorHistory[editorHistoryIndex])}}
function redoEditor(){if(editorHistoryIndex<editorHistory.length-1){editorHistoryIndex++;applyEditorState(editorHistory[editorHistoryIndex])}}
function filterString(){const f=$('photoFilter').value;const filters={none:'',vivid:' saturate(1.35)',dramatic:' saturate(.82) contrast(1.22)',warm:' sepia(.2) saturate(1.15)',cool:' hue-rotate(12deg) saturate(1.08)'};return `brightness(${$('brightness').value}%) contrast(${$('contrast').value}%)${filters[f]||''}`}
function openEditor(){
  const x=items.find(a=>a.id===activeId);
  if(!x||x.type!=='image')return toast('Only photos can be edited');
  editorSource=x;editorRotation=0;editorCrop={x:0,y:0,w:1,h:1};editorHistory=[];editorHistoryIndex=-1;
  $('cropRatio').value='original';$('brightness').value=100;$('contrast').value=100;$('photoFilter').value='none';
  $('brightnessValue').textContent='100%';$('contrastValue').textContent='100%';
  const url=URL.createObjectURL(x.blob),img=new Image();
  img.onload=()=>{editorImage=img;drawEditorPreview();pushEditorHistory();URL.revokeObjectURL(url)};
  img.onerror=()=>{URL.revokeObjectURL(url);toast('Could not open this photo in the editor')};
  img.src=url;$('editor').hidden=false;
}
function drawEditorPreview(){
  if(!editorImage)return;
  const canvas=$('editCanvas'),ctx=canvas.getContext('2d');
  const w=editorRotation%180===0?editorImage.naturalWidth:editorImage.naturalHeight;
  const h=editorRotation%180===0?editorImage.naturalHeight:editorImage.naturalWidth;
  const maxW=Math.max(280,window.innerWidth-36),maxH=Math.max(240,window.innerHeight*.42);
  const scale=Math.min(maxW/w,maxH/h,1);
  canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(editorRotation*Math.PI/180);
  ctx.filter=filterString();
  ctx.drawImage(editorImage,-editorImage.naturalWidth*scale/2,-editorImage.naturalHeight*scale/2,editorImage.naturalWidth*scale,editorImage.naturalHeight*scale);
  ctx.restore();
  const c=editorCrop;
  if(c.w<.999||c.h<.999){ctx.save();ctx.fillStyle='rgba(0,0,0,.48)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.clearRect(c.x*canvas.width,c.y*canvas.height,c.w*canvas.width,c.h*canvas.height);
    // Redraw the selected area crisp above the dimmed overlay.
    ctx.save();ctx.beginPath();ctx.rect(c.x*canvas.width,c.y*canvas.height,c.w*canvas.width,c.h*canvas.height);ctx.clip();
    ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(editorRotation*Math.PI/180);ctx.filter=filterString();
    ctx.drawImage(editorImage,-editorImage.naturalWidth*scale/2,-editorImage.naturalHeight*scale/2,editorImage.naturalWidth*scale,editorImage.naturalHeight*scale);ctx.restore();
    ctx.strokeStyle='#e8efff';ctx.lineWidth=Math.max(2,canvas.width/300);ctx.setLineDash([7,5]);ctx.strokeRect(c.x*canvas.width,c.y*canvas.height,c.w*canvas.width,c.h*canvas.height);ctx.restore();
  }
}
function closeEditor(){$('editor').hidden=true;editorSource=null;editorImage=null;editorHistory=[];editorHistoryIndex=-1}
function cropPointerDown(e){if(!editorImage)return;const c=$('editCanvas'),r=c.getBoundingClientRect();editorDragging=true;editorDragStart={x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};editorCrop={x:editorDragStart.x,y:editorDragStart.y,w:0,h:0};c.setPointerCapture?.(e.pointerId)}
function cropPointerMove(e){if(!editorDragging||!editorDragStart)return;const c=$('editCanvas'),r=c.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.top)/r.height));let left=Math.min(x,editorDragStart.x),top=Math.min(y,editorDragStart.y),width=Math.abs(x-editorDragStart.x),height=Math.abs(y-editorDragStart.y);const ratio=$('cropRatio').value;if(ratio!=='original'){const [rw,rh]=ratio.split(':').map(Number),target=(rw/rh)*(r.height/r.width);if(width/Math.max(height,.001)>target)width=height*target;else height=width/target;left=x<editorDragStart.x?editorDragStart.x-width:editorDragStart.x;top=y<editorDragStart.y?editorDragStart.y-height:editorDragStart.y;}editorCrop={x:Math.max(0,left),y:Math.max(0,top),w:Math.min(width,1-Math.max(0,left)),h:Math.min(height,1-Math.max(0,top))};drawEditorPreview()}
function cropPointerUp(){if(!editorDragging)return;editorDragging=false;editorDragStart=null;if(editorCrop.w<.03||editorCrop.h<.03)editorCrop={x:0,y:0,w:1,h:1};pushEditorHistory();drawEditorPreview()}
async function saveEditedCopy(){
  if(!editorImage||!editorSource)return;
  try{
    const rotation=((editorRotation%360)+360)%360,sw=editorImage.naturalWidth,sh=editorImage.naturalHeight;
    const rw=rotation%180===0?sw:sh,rh=rotation%180===0?sh:sw;
    const temp=document.createElement('canvas');temp.width=rw;temp.height=rh;
    const tctx=temp.getContext('2d');tctx.translate(rw/2,rh/2);tctx.rotate(rotation*Math.PI/180);
    tctx.filter=filterString();tctx.drawImage(editorImage,-sw/2,-sh/2,sw,sh);
    const c=editorCrop,crop={x:c.x*rw,y:c.y*rh,w:c.w*rw,h:c.h*rh},canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(crop.w));canvas.height=Math.max(1,Math.round(crop.h));
    canvas.getContext('2d').drawImage(temp,crop.x,crop.y,crop.w,crop.h,0,0,canvas.width,canvas.height);
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not encode edited photo')),'image/jpeg',.92));
    const record={id:uid(),name:editorSource.name.replace(/\.[^.]+$/,'')+'-edited.jpg',blob,type:'image',mimeType:'image/jpeg',favorite:false,album:editorSource.album||null,created:Date.now(),editedFrom:editorSource.id};
    await req(MEDIA,'readwrite','put',record);
    closeEditor();await load();activeId=record.id;renderViewer();toast('Edited copy saved. Original kept safe.');
  }catch(error){console.error('Photo editor error:',error);toast('Could not save edited photo')}
}
async function setAlbumCover(){
  const x=items.find(a=>a.id===activeId);if(!x)return;
  if(!albums.length)return toast('Create an album first');
  const options=albums.map((a,i)=>`${i+1}. ${a.name}`).join('\n');
  const choice=prompt('Set this photo as the cover of which album?\n'+options);
  const album=albums[Number(choice)-1];if(!album)return;
  album.coverId=x.id;await req(ALBUMS,'readwrite','put',album);
  await load();toast(`Cover updated for ${album.name}`);
}

function moveViewer(dir){const list=currentList(),i=list.findIndex(x=>x.id===activeId),next=list[i+dir];if(next){activeId=next.id;renderViewer()}}
async function toBase64(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(blob)})}
async function fromBase64(s,type){const raw=atob(s),a=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);return new Blob([a],{type})}
async function backup(){try{toast('Preparing backup…');const payload={format:'TWK-GALLERY-BACKUP',version:1,created:new Date().toISOString(),albums,items:[]};for(const x of items)payload.items.push({...x,blobBase64:await toBase64(x.blob),blob:undefined});const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`TWK-Gallery-Backup-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('Backup downloaded')}catch(e){console.error(e);toast('Backup failed — storage or memory limit')}}
async function restoreBackup(file){try{const data=JSON.parse(await file.text());if(data.format!=='TWK-GALLERY-BACKUP'||!Array.isArray(data.items)||!Array.isArray(data.albums))throw Error('Invalid backup');if(!confirm(`Restore ${data.items.length} media items and ${data.albums.length} albums? Existing items with matching IDs will be replaced.`))return;for(const a of data.albums)await req(ALBUMS,'readwrite','put(a)'.replace('put(a)','put'),a);for(const x of data.items){const {blobBase64,...meta}=x;meta.blob=await fromBase64(blobBase64,x.mimeType||'application/octet-stream');await req(MEDIA,'readwrite','put',meta)}await load();toast('Backup restored successfully')}catch(e){console.error(e);toast('Restore failed: invalid backup file')}}
function startSlideshow(){const pics=items.filter(x=>x.type==='image');if(!pics.length)return toast('No photos for slideshow');let i=0;const show=()=>{activeId=pics[i].id;renderViewer();i=(i+1)%pics.length};show();clearInterval(slideTimer);slideTimer=setInterval(show,3000);$('slideshowBtn').textContent='Stop slideshow';$('slideshowBtn').onclick=()=>{clearInterval(slideTimer);slideTimer=null;closeViewer();$('slideshowBtn').textContent='Slideshow';$('slideshowBtn').onclick=startSlideshow}}
function openMediaPicker(){
  const picker=$('fileInput');
  picker.value='';
  picker.click();
}
$('addBtn').addEventListener('click',openMediaPicker);
$('emptyAdd').addEventListener('click',openMediaPicker);
$('fileInput').addEventListener('change',async e=>{
  const files=Array.from(e.target.files||[]);
  if(!files.length)return;
  let added=0,failed=0;
  toast('Adding selected media…');
  try{
    for(const f of files){
      if(!f.type.startsWith('image/')&&!f.type.startsWith('video/'))continue;
      try{
        const blob=new Blob([f],{type:f.type||'application/octet-stream'});
        const record={
          id:uid(),
          name:f.name||`media-${Date.now()}`,
          blob,
          type:f.type.startsWith('video/')?'video':'image',
          mimeType:f.type||'application/octet-stream',
          favorite:false,
          album:null,
          created:Date.now()
        };
        await req(MEDIA,'readwrite','put',record);
        added++;
      }catch(fileError){
        console.error('TWK Gallery media save failed:',fileError);
        failed++;
      }
    }
    await load();
    if(added&&failed)toast(`${added} added; ${failed} failed`);
    else if(added)toast(`${added} item${added===1?'':'s'} added successfully`);
    else toast('Could not save media. Check browser storage space and try a smaller photo.');
  }catch(error){
    console.error('TWK Gallery upload error:',error);
    toast(`Upload failed: ${error.name||'Storage error'}`);
  }finally{
    e.target.value='';
  }
});
$('tabs').onclick=e=>{const b=e.target.closest('[data-view]');if(!b)return;view=b.dataset.view;activeAlbum=null;selected.clear();selectionMode=false;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===b));render()};
$('search').oninput=render;$('sortBtn').onclick=async()=>{sortMode=sortMode==='newest'?'oldest':'newest';$('sortBtn').textContent=sortMode==='newest'?'Newest first':'Oldest first';await load()};
$('selectBtn').onclick=()=>{selected.clear();selectionMode=true;view='all';activeAlbum=null;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view==='all'));render();toast('Tap photos to select them')};
$('clearSelection').onclick=()=>{selected.clear();selectionMode=false;render()};$('selectAll').onclick=()=>{currentList().forEach(x=>selected.add(x.id));render()};
$('moveSelected').onclick=async()=>{if(!albums.length)return toast('Create an album first');const opts=albums.map((a,i)=>`${i+1}. ${a.name}`).join('\n'),n=prompt('Move selected items to which album?\n'+opts),a=albums[Number(n)-1];if(!a)return;for(const id of selected){const x=items.find(x=>x.id===id);if(x){x.album=a.id;await req(MEDIA,'readwrite','put',x)}}selected.clear();selectionMode=false;await load();toast('Items moved to album')};
$('deleteSelected').onclick=async()=>{if(!selected.size||!confirm(`Move ${selected.size} items to Recently Deleted?`))return;for(const id of selected){const x=items.find(x=>x.id===id);if(x)await moveToTrash(x)}selected.clear();selectionMode=false;await load();toast('Moved to Recently Deleted')};
$('closeViewer').onclick=closeViewer;$('prevBtn').onclick=()=>moveViewer(-1);$('nextBtn').onclick=()=>moveViewer(1);let touchX=0;$('viewerStage').addEventListener('touchstart',e=>touchX=e.changedTouches[0].screenX,{passive:true});$('viewerStage').addEventListener('touchend',e=>{const dx=e.changedTouches[0].screenX-touchX;if(Math.abs(dx)>80)moveViewer(dx<0?1:-1)},{passive:true});
$('favoriteBtn').onclick=async()=>{const x=items.find(a=>a.id===activeId);if(!x)return;x.favorite=!x.favorite;await req(MEDIA,'readwrite','put',x);$('favoriteBtn').textContent=x.favorite?'♥ Favorited':'♡ Favorite';await load()};
$('editBtn').onclick=openEditor;
$('coverBtn').onclick=setAlbumCover;
$('closeEditor').onclick=closeEditor;
$('rotateLeft').onclick=()=>{editorRotation=(editorRotation+270)%360;editorCrop={x:0,y:0,w:1,h:1};drawEditorPreview();pushEditorHistory()};
$('rotateRight').onclick=()=>{editorRotation=(editorRotation+90)%360;editorCrop={x:0,y:0,w:1,h:1};drawEditorPreview();pushEditorHistory()};
$('cropRatio').onchange=()=>{editorCrop={x:0,y:0,w:1,h:1};drawEditorPreview();pushEditorHistory()};
$('photoFilter').onchange=()=>{drawEditorPreview();pushEditorHistory()};
$('brightness').onchange=()=>pushEditorHistory();
$('contrast').onchange=()=>pushEditorHistory();
$('undoEdit').onclick=undoEditor;$('redoEdit').onclick=redoEditor;
$('editCanvas').addEventListener('pointerdown',cropPointerDown);
$('editCanvas').addEventListener('pointermove',cropPointerMove);
$('editCanvas').addEventListener('pointerup',cropPointerUp);
$('editCanvas').addEventListener('pointercancel',cropPointerUp);
$('brightness').oninput=()=>{$('brightnessValue').textContent=$('brightness').value+'%';drawEditorPreview()};
$('contrast').oninput=()=>{$('contrastValue').textContent=$('contrast').value+'%';drawEditorPreview()};
$('saveEdit').onclick=saveEditedCopy;
$('detailsBtn').onclick=()=>{const x=items.find(a=>a.id===activeId);if(x)alert(`Name: ${x.name}\nType: ${x.blob.type||x.type}\nSize: ${formatBytes(x.blob.size)}\nDate: ${new Date(x.created).toLocaleString()}\nDimensions: available in original media metadata`)};
$('shareBtn').onclick=async()=>{const x=items.find(a=>a.id===activeId);if(!x)return;const f=new File([x.blob],x.name,{type:x.blob.type});try{if(navigator.canShare?.({files:[f]}))await navigator.share({files:[f],title:x.name});else{const a=document.createElement('a');a.href=URL.createObjectURL(x.blob);a.download=x.name;a.click();toast('Downloaded file')}}catch(e){if(e.name!=='AbortError')toast('Sharing unavailable')}};
$('deleteBtn').onclick=async()=>{const x=items.find(a=>a.id===activeId);if(x&&confirm('Move this item to Recently Deleted? It will be kept for up to 30 days. Original in Apple Photos is unchanged.')){await moveToTrash(x);closeViewer();await load();toast('Moved to Recently Deleted')}};
$('backupBtn').onclick=backup;$('restoreBtn').onclick=()=>$('restoreInput').click();$('restoreInput').onchange=async e=>{if(e.target.files[0])await restoreBackup(e.target.files[0]);e.target.value=''};$('slideshowBtn').onclick=startSlideshow;$('cancelModal').onclick=()=>$('modal').hidden=true;
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
(async()=>{try{db=await openDB();await load()}catch(e){console.error(e);toast('Storage unavailable in this browser')}})();

window.addEventListener('resize',()=>{if(editorImage)drawEditorPreview()});
