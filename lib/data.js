import { STORES } from "./constants";
const STORE_KEYS = Object.keys(STORES);

async function fetchOneDepartment(storeKey) {
  try {
    const initRes = await fetch(`/api/dialpad/stats?action=initiate&store=${storeKey}`);
    const initJson = await initRes.json();
    if (!initJson.success || !initJson.requestId) { console.error(`Initiate failed for ${storeKey}:`, initJson.error); return null; }
    const requestId = initJson.requestId;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      const pollRes = await fetch(`/api/dialpad/stats?action=poll&requestId=${requestId}`);
      const pollJson = await pollRes.json();
      if (pollJson.state === "completed" && pollJson.data) return pollJson.data;
      if (!pollJson.success && pollJson.error) { console.error(`Poll error for ${storeKey}:`, pollJson.error); return null; }
    }
    return null;
  } catch (err) { console.error(`Failed to fetch ${storeKey}:`, err); return null; }
}

export async function fetchLiveStats() {
  const allRecords = [];
  for (const storeKey of STORE_KEYS) {
    console.log(`Fetching data for ${storeKey}...`);
    const data = await fetchOneDepartment(storeKey);
    if (data && data.length > 0) {
      data.forEach(row => { row._storeKey = storeKey; });
      allRecords.push(...data);
      console.log(`${storeKey}: ${data.length} records`);
    }
  }
  return allRecords.length > 0 ? allRecords : null;
}

function isDept(row) { return row.target_type === "department"; }
function isInbound(row) { return row.direction === "inbound"; }
function getStore(row) { return row._storeKey || null; }
function isAnswered(row) { return (row.categories || "").includes("answered"); }
function isMissed(row) { const c = row.categories || ""; return c.includes("missed") || c.includes("unanswered") || c.includes("abandoned") || c.includes("voicemail"); }

// FIX: Only count inbound department calls, and track missed using isMissed()
export function transformToDailyCalls(rows) {
  const dr = rows.filter(r => isDept(r) && isInbound(r));
  const m = {};
  dr.forEach(row => {
    const sk = getStore(row); if (!sk) return;
    const d = new Date(row.date_started); if (isNaN(d)) return;
    const dk = `${d.getMonth()+1}/${d.getDate()}`;
    if (!m[dk]) {
      m[dk] = { date: dk };
      STORE_KEYS.forEach(k => { m[dk][`${k}_total`] = 0; m[dk][`${k}_answered`] = 0; m[dk][`${k}_missed`] = 0; });
    }
    m[dk][`${sk}_total`]++;
    if (isAnswered(row)) m[dk][`${sk}_answered`]++;
    if (isMissed(row)) m[dk][`${sk}_missed`]++;
  });
  return Object.values(m).sort((a,b) => { const [am,ad]=a.date.split("/").map(Number); const [bm,bd]=b.date.split("/").map(Number); return am!==bm?am-bm:ad-bd; });
}

export function transformToHourlyMissed(rows) {
  const dr = rows.filter(r => isDept(r) && isInbound(r));
  const hm = {};
  for (let h=9;h<=20;h++) { const l=h<=12?`${h}AM`:`${h-12}PM`; hm[h]={hour:l}; STORE_KEYS.forEach(k=>{hm[h][k]=0;}); }
  dr.forEach(row => { const sk=getStore(row); if(!sk||!isMissed(row)) return; const d=new Date(row.date_started); if(isNaN(d)) return; if(hm[d.getHours()]) hm[d.getHours()][sk]++; });
  return Object.values(hm);
}

export function transformToDOWMissed(rows) {
  const dr = rows.filter(r => isDept(r) && isInbound(r));
  const days=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const dm = days.map(day => { const o={day}; STORE_KEYS.forEach(k=>{o[k]=0;}); return o; });
  dr.forEach(row => { const sk=getStore(row); if(!sk||!isMissed(row)) return; const d=new Date(row.date_started); if(isNaN(d)) return; dm[d.getDay()][sk]++; });
  return dm;
}

export function transformToCallbackData(rows) {
  const dr = rows.filter(isDept);
  return STORE_KEYS.map(sk => {
    const sr = dr.filter(r=>getStore(r)===sk); const mc=[]; const ob=[];
    sr.forEach(row => {
      if(row.direction==="inbound"&&isMissed(row)) mc.push({phone:row.external_number,time:new Date(row.date_started)});
      if(row.direction==="outbound") ob.push({phone:row.external_number,time:new Date(row.date_started)});
    });
    let w30=0,w60=0,later=0,never=0;
    mc.forEach(m => { const cb=ob.find(o=>o.phone===m.phone&&o.time>m.time); if(!cb){never++;} else { const d=(cb.time-m.time)/60000; if(d<=30)w30++;else if(d<=60)w60++;else later++; } });
    return {store:sk,missed:mc.length,calledBack:w30+w60+later,within30:w30,within60:w60,later,never};
  });
}

export function transformToProblemCalls(rows) {
  const dr = rows.filter(isDept);
  const types = [
    {type:"Long Wait (>3min ring)",test:r=>parseFloat(r.ringing_duration||"0")>3},
    {type:"Voicemail",test:r=>(r.categories||"").includes("voicemail")},
    {type:"Abandoned",test:r=>(r.categories||"").includes("abandoned")},
    {type:"Missed (no answer)",test:r=>(r.categories||"").includes("missed")&&!(r.categories||"").includes("voicemail")},
    {type:"After Hours",test:r=>r.availability==="closed"},
  ];
  return types.map(({type,test}) => { const res={type}; STORE_KEYS.forEach(k=>{res[k]=0;}); dr.forEach(row=>{const sk=getStore(row);if(sk&&test(row))res[sk]++;}); return res; });
}

export const SAMPLE_KEYWORDS = [
  {keyword:"screen repair",category:"Service",fishers:142,bloomington:118,indianapolis:156},
  {keyword:"battery replacement",category:"Service",fishers:98,bloomington:87,indianapolis:104},
  {keyword:"water damage",category:"Service",fishers:54,bloomington:41,indianapolis:62},
  {keyword:"price / cost",category:"Sales",fishers:189,bloomington:167,indianapolis:201},
  {keyword:"warranty",category:"Support",fishers:67,bloomington:52,indianapolis:71},
  {keyword:"how long / wait time",category:"Operations",fishers:134,bloomington:112,indianapolis:148},
  {keyword:"appointment",category:"Operations",fishers:45,bloomington:38,indianapolis:52},
  {keyword:"status / update",category:"Support",fishers:113,bloomington:96,indianapolis:121},
  {keyword:"frustrated / upset",category:"Problem",fishers:28,bloomington:34,indianapolis:22},
  {keyword:"manager / escalation",category:"Problem",fishers:14,bloomington:19,indianapolis:11},
  {keyword:"wrong part / misquote",category:"Problem",fishers:8,bloomington:12,indianapolis:6},
  {keyword:"insurance claim",category:"Sales",fishers:36,bloomington:29,indianapolis:42},
  {keyword:"data recovery",category:"Service",fishers:31,bloomington:24,indianapolis:28},
  {keyword:"trade-in",category:"Sales",fishers:22,bloomington:18,indianapolis:27},
  {keyword:"refund / return",category:"Problem",fishers:17,bloomington:21,indianapolis:13},
];
export const SAMPLE_HOURLY_MISSED = Array.from({length:12},(_,i)=>{const h=i+9;const l=h<=12?`${h}AM`:`${h-12}PM`;const b=h>=11&&h<=14?8:h>=16?6:3;const s=(h*7+13)%5;return{hour:l,fishers:b+s,bloomington:b+((s+2)%5),indianapolis:b+((s+4)%4)};});
export const SAMPLE_DAILY_CALLS = Array.from({length:30},(_,i)=>{const d=new Date(2026,1,9+i);const w=d.getDay();const we=w===0||w===6;const b=we?18:42;const s=((i*13+7)%10);return{date:`${d.getMonth()+1}/${d.getDate()}`,fishers_total:b+s,fishers_answered:b-4+Math.min(s,8),fishers_missed:4+s%3,bloomington_total:b-3+s,bloomington_answered:b-7+Math.min(s,7),bloomington_missed:5+s%4,indianapolis_total:b+2+s,indianapolis_answered:b-2+Math.min(s,9),indianapolis_missed:3+s%3};});
export const SAMPLE_CALLBACK_DATA = [{store:"fishers",missed:156,calledBack:112,within30:78,within60:24,later:10,never:44},{store:"bloomington",missed:184,calledBack:118,within30:62,within60:32,later:24,never:66},{store:"indianapolis",missed:132,calledBack:108,within30:82,within60:18,later:8,never:24}];
export const SAMPLE_PROBLEM_CALLS = [{type:"Long Hold Time (>3min)",fishers:34,bloomington:48,indianapolis:26},{type:"Negative Sentiment",fishers:28,bloomington:34,indianapolis:22},{type:"Escalation Request",fishers:14,bloomington:19,indianapolis:11},{type:"Repeat Caller (same issue)",fishers:22,bloomington:27,indianapolis:18},{type:"Misquote / Wrong Info",fishers:8,bloomington:12,indianapolis:6},{type:"Refund / Complaint",fishers:17,bloomington:21,indianapolis:13}];
export const SAMPLE_DOW_DATA = [{day:"Mon",fishers:22,bloomington:28,indianapolis:18},{day:"Tue",fishers:18,bloomington:24,indianapolis:15},{day:"Wed",fishers:20,bloomington:22,indianapolis:17},{day:"Thu",fishers:19,bloomington:26,indianapolis:16},{day:"Fri",fishers:24,bloomington:30,indianapolis:20},{day:"Sat",fishers:32,bloomington:38,indianapolis:28},{day:"Sun",fishers:12,bloomington:14,indianapolis:10}];
