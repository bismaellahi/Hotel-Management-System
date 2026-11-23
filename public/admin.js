const $=id=>document.getElementById(id);
const rs=n=>'Rs '+Number(n).toLocaleString();
const esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
let tok=sessionStorage.getItem('tok')||'',c1,c2;

async function api(url,opt={}){
 const h={'Content-Type':'application/json'};if(tok)h['x-token']=tok;
 const r=await fetch(url,{...opt,headers:h}),d=await r.json().catch(()=>({}));
 if(r.status==401&&tok)logout();
 if(!r.ok)throw new Error(d.error||'Request failed');
 return d}
const stage=b=>b.status=='cancelled'?'Cancelled':b.stage.replace('_','-');

function login(){api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('au').value,password:$('ap').value})})
 .then(d=>{tok=d.token;sessionStorage.setItem('tok',tok);$('ap').value='';adminInit()}).catch(e=>alert(e.message))}
function logout(){tok='';sessionStorage.removeItem('tok');adminInit()}
function adminInit(){$('login').classList.toggle('hide',!!tok);$('panel').classList.toggle('hide',!tok);if(tok)tab('dash')}
function tab(n){['dash','desk','books','rooms','revs'].forEach(t=>$('t-'+t).classList.toggle('hide',t!=n));
 ({dash,books,rooms:adminRooms,revs:adminRevs}[n]||(()=>{}))()}

async function dash(){
 const [bk,rm]=await Promise.all([api('/api/bookings'),api('/api/rooms')]);
 const act=bk.filter(b=>b.status=='confirmed'),rev=act.reduce((s,b)=>s+b.total,0),inH=act.filter(b=>b.stage=='checked_in').length;
 $('stats').innerHTML=[['Bookings',act.length],['Revenue',rs(rev)],['Guests in house',inH],['Occupancy now',rm.length?Math.round(inH/rm.length*100)+'%':'0%']].map(([a,b])=>`<div class="card">${a}<div class="stat">${b}</div></div>`).join('');
 const mon={},rt={};act.forEach(b=>{const k=b.check_in.slice(0,7);mon[k]=(mon[k]||0)+b.total;rt[b.type]=(rt[b.type]||0)+1});
 const ks=Object.keys(mon).sort();
 if(typeof Chart!='undefined'){c1&&c1.destroy();c2&&c2.destroy();
  c1=new Chart($('c1'),{type:'bar',data:{labels:ks,datasets:[{label:'Revenue (Rs)',data:ks.map(k=>mon[k]),backgroundColor:'#2c5282'}]},options:{maintainAspectRatio:false}});
  c2=new Chart($('c2'),{type:'doughnut',data:{labels:Object.keys(rt),datasets:[{data:Object.values(rt),backgroundColor:['#14284a','#2c5282','#7aa2d4','#a9c1e0']}]},options:{maintainAspectRatio:false}})}
 $('tbl').innerHTML='<tr><th>ID</th><th>Guest</th><th>Room</th><th>Stay</th><th>Total</th><th>Status</th></tr>'+
 bk.slice(0,10).map(b=>`<tr><td>${b.id}</td><td>${esc(b.guest_name)}</td><td>${esc(b.room_number)}</td><td>${b.check_in} to ${b.check_out}</td><td>${rs(b.total)}</td><td><span class="tag">${stage(b)}</span></td></tr>`).join('')}

async function lookup(){
 const o=$('res');o.classList.remove('hide');
 try{const b=await api('/api/bookings/'+encodeURIComponent($('bid').value.trim()));
  const next=b.status=='confirmed'?(b.stage=='booked'?'Check in guest':b.stage=='checked_in'?'Check out guest':''):'';
  o.innerHTML=`<table><tr><th>Guest</th><td>${esc(b.guest_name)}</td></tr><tr><th>Room</th><td>${esc(b.room_number)} (${esc(b.type)})</td></tr><tr><th>Stay</th><td>${b.check_in} to ${b.check_out}</td></tr><tr><th>Services</th><td>${esc(b.services||'None')}</td></tr><tr><th>Total</th><td>${rs(b.total)}</td></tr><tr><th>Status</th><td><span class="tag">${stage(b)}</span></td></tr></table><br>`+
  (next?`<button class="btn" onclick="advance(${b.id})">${next}</button>`:'')
 }catch(e){o.innerHTML='<p>'+esc(e.message)+'</p>'}}
async function advance(id){try{await api(`/api/bookings/${id}/stage`,{method:'PUT'});lookup()}catch(e){alert(e.message)}}

async function books(){
 const bk=await api('/api/bookings');
 $('allB').innerHTML='<tr><th>ID</th><th>Guest</th><th>Phone</th><th>Room</th><th>Stay</th><th>Services</th><th>Total</th><th>Status</th><th></th></tr>'+
 bk.map(b=>`<tr><td>${b.id}</td><td>${esc(b.guest_name)}</td><td>${esc(b.phone)}</td><td>${esc(b.room_number)}</td><td>${b.check_in} to ${b.check_out}</td><td>${esc(b.services||'-')}</td><td>${rs(b.total)}</td><td><span class="tag">${stage(b)}</span></td><td>${b.status=='confirmed'&&b.stage=='booked'?`<button class="btn sm" onclick="cancelB(${b.id})">Cancel</button>`:''}</td></tr>`).join('')}
async function cancelB(id){if(confirm('Cancel this booking?')){await api(`/api/bookings/${id}/cancel`,{method:'PUT'});books()}}

async function adminRooms(){
 const r=await api('/api/rooms');
 $('rl').innerHTML='<tr><th>Room</th><th>Type</th><th>Price</th><th>Capacity</th><th></th></tr>'+
 r.map(x=>`<tr><td>${esc(x.room_number)}</td><td>${esc(x.type)}</td><td>${rs(x.price)}</td><td>${x.capacity}</td><td><button class="btn sm" onclick="delRoom(${x.id})">Delete</button></td></tr>`).join('')}
async function addRoom(){
 try{await api('/api/rooms',{method:'POST',body:JSON.stringify({room_number:$('rn').value.trim(),type:$('rt').value.trim(),price:+$('rp').value,capacity:+$('rc').value})});
  ['rn','rt','rp','rc'].forEach(i=>$(i).value='');adminRooms()
 }catch(e){alert(e.message)}}
async function delRoom(id){if(confirm('Delete this room and its bookings?')){await api('/api/rooms/'+id,{method:'DELETE'});adminRooms()}}

async function adminRevs(){
 const l=await api('/api/reviews');
 $('rvAdmin').innerHTML='<tr><th>Guest</th><th>Room</th><th>Rating</th><th>Comment</th><th></th></tr>'+
 l.map(v=>`<tr><td>${esc(v.guest_name)}</td><td>${esc(v.room_number)}</td><td>${v.rating}</td><td>${esc(v.comment)}</td><td><button class="btn sm" onclick="delRev(${v.id})">Delete</button></td></tr>`).join('')}
async function delRev(id){if(confirm('Delete this review?')){await api('/api/reviews/'+id,{method:'DELETE'});adminRevs()}}


adminInit();