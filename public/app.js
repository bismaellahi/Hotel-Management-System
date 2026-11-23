const $=id=>document.getElementById(id);
const rs=n=>'Rs '+Number(n).toLocaleString();
const esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const iso=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
let allRooms=[],SVC=[],cur=null;

async function api(url,opt={}){
 const h={'Content-Type':'application/json'};
 const r=await fetch(url,{...opt,headers:h}),d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||'Request failed');
 return d}
const stars=r=>r.review_count?'\u2605 '+r.avg_rating+' ('+r.review_count+' review'+(r.review_count>1?'s':'')+')':'No reviews yet';

async function render(filter){
 const i=$('sin').value,o=$('sout').value,ok=i&&o&&o>i;
 if(filter&&!ok)return alert('Select a valid check-in and check-out date.');
 try{
  allRooms=await api('/api/rooms');
  let avail=null,quotes={};
  if(ok){avail=new Set((await api(`/api/rooms?checkin=${i}&checkout=${o}`)).map(r=>r.id));
   await Promise.all(allRooms.filter(r=>avail.has(r.id)).map(async r=>{quotes[r.id]=(await api(`/api/quote?room_id=${r.id}&checkin=${i}&checkout=${o}`)).total}))}
  const list=filter?allRooms.filter(r=>avail.has(r.id)):allRooms;
  $('rooms').innerHTML=list.length?list.map(r=>{
   const free=!ok||avail.has(r.id);
   return `<div class="rc"><h3>Room ${esc(r.room_number)}</h3><p>${esc(r.type)} | Sleeps ${r.capacity}</p><p class="mut">${stars(r)}</p>
   <p><b>${ok&&free?rs(quotes[r.id])+' total':'From '+rs(r.price)+' / night'}</b></p>`+
   (free?`<button class="btn" onclick="openBook(${r.id})">Book now</button>`:'<span class="tag no">Booked for these dates</span>')+'</div>'}).join('')
   :'<div class="card">No rooms are free for these dates. Try different dates.</div>'
 }catch(e){$('rooms').innerHTML='<div class="card">'+esc(e.message)+'</div>'}}
function clearS(){$('sin').value=$('sout').value='';render()}

function openBook(id){cur=allRooms.find(r=>r.id==id);$('mt').textContent='Book Room '+cur.room_number+' ('+cur.type+')';
 $('in').value=$('sin').value;$('out').value=$('sout').value;
 $('svc').innerHTML=SVC.map(s=>`<label class="chk"><input type="checkbox" value="${s.id}" onchange="mq()">${esc(s.name)} (${rs(s.price)})</label>`).join('');
 $('bf').classList.remove('hide');$('done').classList.add('hide');$('modal').classList.remove('hide');mq()}
function closeM(){$('modal').classList.add('hide')}
const picked=()=>[...document.querySelectorAll('#svc input:checked')].map(x=>x.value);
async function mq(){const i=$('in').value,o=$('out').value;
 if(!(i&&o&&o>i)){$('quote').textContent='Choose valid dates to see the live price.';return}
 try{const q=await api(`/api/quote?room_id=${cur.id}&checkin=${i}&checkout=${o}`),ex=picked().reduce((s,x)=>s+SVC.find(v=>v.id==x).price,0);
  $('quote').innerHTML='<table><tr><th>Night</th><th>Rate</th><th>Why</th></tr>'+q.rows.map(r=>`<tr><td>${r.date}</td><td>${rs(r.price)}</td><td>${r.note}</td></tr>`).join('')+
  `</table><p>Extra services ${rs(ex)}</p><p class="total">Total ${rs(q.total+ex)}</p>`
 }catch(e){$('quote').textContent=e.message}}
async function confirmBook(){
 const name=$('name').value.trim(),phone=$('phone').value.trim();
 if(!name||!phone)return alert('Enter the guest name and phone number.');
 try{const d=await api('/api/bookings',{method:'POST',body:JSON.stringify({room_id:cur.id,guest_name:name,phone,check_in:$('in').value,check_out:$('out').value,services:picked()})});
  $('bf').classList.add('hide');$('done').classList.remove('hide');
  $('doneTxt').innerHTML=`Booking ID <b>${d.booking_id}</b> for ${esc(name)}, Room ${esc(cur.room_number)}. Total ${rs(d.total)}. Keep your booking ID and phone number to write a review.`;
  $('qr').innerHTML='';
  if(typeof QRCode!='undefined')new QRCode($('qr'),{text:String(d.booking_id),width:150,height:150});
  else $('qr').textContent='The QR library could not load. Check your internet connection.';
  render()
 }catch(e){alert(e.message)}}

async function loadReviews(){
 await render();
 $('rvRoom').innerHTML=allRooms.map(r=>`<option value="${r.id}">Room ${esc(r.room_number)}</option>`).join('');
 const l=await api('/api/reviews');
 $('rvList').innerHTML=l.length?l.map(v=>`<p><b>${esc(v.guest_name)}</b> on Room ${esc(v.room_number)}: \u2605 ${v.rating}<br>${esc(v.comment)}</p>`).join(''):'<p>No reviews yet.</p>'}
async function sendReview(){
 try{const d=await api('/api/reviews',{method:'POST',body:JSON.stringify({room_id:+$('rvRoom').value,booking_id:+$('rvBid').value,phone:$('rvPhone').value,rating:+$('rvStars').value,comment:$('rvText').value})});
  alert(d.message);$('rvText').value='';loadReviews()
 }catch(e){alert(e.message)}}

function show(id,scroll){
 ['home','reviews'].forEach(s=>$(s).classList.toggle('hide',s!=id));
 if(id=='reviews')loadReviews();
 if(scroll)$('rooms').scrollIntoView({behavior:'smooth'});else window.scrollTo(0,0)}

async function reply(t){t=t.toLowerCase();
 if(/hi\b|hello|salam|assalam/.test(t))return 'Hello! I am the StayEase assistant. Ask me about rooms, prices, services or timings.';
 if(/price|rate|cost|charge|rent/.test(t))return 'Base rates per night:\n'+allRooms.map(r=>'Room '+r.room_number+' ('+r.type+'): '+rs(r.price)).join('\n')+'\nRates go up on weekends and in peak season (Dec, Jan, Jun). Booking 30 or more days ahead gets a 10% discount.';
 if(/available|vacant|free/.test(t)){const a=iso(new Date()),n=new Date();n.setDate(n.getDate()+1);
  const f=await api(`/api/rooms?checkin=${a}&checkout=${iso(n)}`);
  return f.length?'Rooms available tonight: '+f.map(r=>r.room_number+' ('+r.type+')').join(', '):'No rooms are available tonight.'}
 if(/service|breakfast|laundry|pickup|extra/.test(t))return 'Extra services for your whole stay:\n'+SVC.map(s=>s.name+': '+rs(s.price)).join('\n');
 if(/check.?in|check.?out|timing|time/.test(t))return 'Check-in starts at 2:00 PM and check-out is until 12:00 PM. Early check-in depends on availability.';
 if(/wifi|parking|facilit/.test(t))return 'Free WiFi, secure parking, 24/7 room service and air conditioning in every room.';
 if(/review|rating/.test(t))return 'Open the Reviews page and enter your booking ID and phone number to rate your room.';
 if(/book|reserve/.test(t))return 'On the home page, choose your dates, click "Book now" on a room, pick any extra services and confirm. You will receive a QR code.';
 if(/cancel|refund/.test(t))return 'To cancel a booking, please contact the reception with your booking ID.';
 if(/qr|scan/.test(t))return 'You get a QR code when your booking is confirmed. Show it at the reception for a quick check-in.';
 return 'Sorry, I did not understand that. Ask me about prices, available rooms, services, timings or facilities.'}
function add(c,t){const d=document.createElement('div');d.className='m '+c;d.textContent=t;$('msgs').appendChild(d);$('msgs').scrollTop=1e9}
function send(){const t=$('cin').value.trim();if(!t)return false;add('me',t);$('cin').value='';
 reply(t).then(x=>add('bot',x)).catch(()=>add('bot','Sorry, I could not reach the server.'));return false}
add('bot','Hello! I am the StayEase assistant. How can I help you?');

$('sin').min=$('sout').min=iso(new Date());
api('/api/services').then(s=>SVC=s).catch(()=>{});
render();