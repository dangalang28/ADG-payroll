"use client";
import { useState, useCallback, useRef, useMemo } from "react";

const DEFAULT_CONFIG = {
  companyId: "70157401", payComponentREG: "Hourly", payComponentOT: "Overtime reg amt",
  payComponentPerDiem: "Per Diem Non Tax", targetMargin: 0.30,
  weekEnding: new Date().toISOString().split("T")[0], otThreshold: 40,
};

const RATE_CARD = [
  { title: "A&P Mechanic", billREG: 51, billOT: 61, company: "Qarbon/RedOak" },
  { title: "A&P Mechanic (54)", billREG: 54, billOT: 64, company: "Qarbon/RedOak" },
  { title: "Interior", billREG: 46, billOT: 56, company: "Qarbon/RedOak" },
  { title: "Prepper", billREG: 26, billOT: 36, company: "Qarbon/RedOak" },
  { title: "Mechanic", billREG: 51, billOT: 61, company: "Qarbon/RedOak" },
  { title: "Composite", billREG: 71.24, billOT: 106.86, company: "Qarbon/RedOak" },
  { title: "Special (59.20)", billREG: 59.2, billOT: 82.88, company: "Qarbon/RedOak" },
  { title: "Bonder", billREG: 45.5, billOT: 68.25, company: "Qarbon/RedOak" },
  { title: "Structure (38.22)", billREG: 38.22, billOT: 51.75, company: "Qarbon/RedOak" },
  { title: "Sealer/Structure", billREG: 63.21, billOT: 86.06, company: "Qarbon/RedOak" },
];

const DEFAULT_CONTRACTORS = [
  "Ariza, Roberto","Blanco, Jerson","Bonilla, Fernando","Centeno Lafaurie, Oscar Jose",
  "Chan, Allan","Cordova, Marco","Coronado, Christian","Cortes, Gustavo","Donado, Delmar",
  "Edwards, Renado","Fanney, Dominique","Goosetree, Donald","Hoang, Dianna","Huffman, Ginger",
  "Hurtado, Daniel","Lemons, Dinah","McCarrell, Stacy","Olaya, Jhon","Ortiz, Nelson",
  "Pujols, Ariam","Rabeiro, Osmel","Ramsey, Bryson","Reyes, Mario","Schofield, Liam",
  "Tran, Tuan","Williams, Gemel","Zabala, Arbenys",
].map(name => ({ name, workerId:"", client:"", location:"", jobTitle:"A&P Mechanic", payREG:0, payOT:0, billREG:51, billOT:61, perDiemDefault:0, active:true }));

const COL_ALIASES = {
  name:["employee name","name","worker","employee","contractor","full name","worker name","last, first","emp name","employee_name","contractor name","contractor name (standard)"],
  firstName:["first name","first","firstname","first_name","fname"],
  lastName:["last name","last","lastname","last_name","lname","surname"],
  regHours:["reg hours","regular hours","hours","reg","regular","straight time","st hours","reg hrs","regular hrs","hours regular","straight hours","st","reg_hours","total hours"],
  otHours:["ot hours","overtime hours","overtime","ot","ot hrs","overtime hrs","hours overtime","ot_hours"],
  perDiem:["per diem","perdiem","per_diem","daily allowance","per diem amount"],
  payRate:["pay rate","rate","hourly rate","pay_rate","hourly","reg rate","regular rate","pay rate reg"],
  jobTitle:["job title","title","position","job","role","classification","job_title","craft"],
  client:["client","customer","company","client name","project","job site","site"],
  weekEnding:["week ending","we","week end","weekending","period ending","pay period end","week_ending","date"],
  workerId:["worker id","emp id","employee id","worker_id","employee_id","paychex id","id","badge"],
  department:["department","dept","location / dept","division","cost center"],
};

const fmt = (n) => new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n||0);
const fmtPct = (n) => ((n||0)*100).toFixed(1)+"%";
const toDateStr = (d) => { const dt=new Date(d+"T12:00:00"); return String(dt.getMonth()+1).padStart(2,"0")+"/"+String(dt.getDate()).padStart(2,"0")+"/"+dt.getFullYear(); };
const weekStart = (we) => { const d=new Date(we+"T12:00:00"); d.setDate(d.getDate()-6); return d.toISOString().split("T")[0]; };
const uid = () => Math.random().toString(36).slice(2,10);

function matchCol(header, aliases) {
  const h = header.toLowerCase().trim();
  for (const [key, vals] of Object.entries(aliases)) { if (vals.includes(h)) return key; }
  return null;
}

function fuzzyName(imported, contractors) {
  const imp = imported.toLowerCase().replace(/[^a-z ]/g,"").trim();
  let best=null, bestScore=0;
  for (const c of contractors) {
    const std = c.name.toLowerCase().replace(/[^a-z ]/g,"").trim();
    if (std===imp) return {match:c.name,confidence:100};
    const ip=imp.split(/\s+/), sp=std.split(/[,\s]+/).filter(Boolean);
    let score=0;
    for (const a of ip) for (const b of sp) { if(b===a) score+=40; else if(b.startsWith(a)||a.startsWith(b)) score+=20; }
    if (score>bestScore) { bestScore=score; best=c.name; }
  }
  if (bestScore>=40) return {match:best,confidence:bestScore>=80?95:bestScore>=60?75:50};
  return null;
}

const C = {
  bg:"#0c1117",surface:"#151d27",surfaceAlt:"#1a2332",border:"#243044",
  accent:"#22c55e",accentDim:"#166534",accentBright:"#4ade80",
  warn:"#f59e0b",warnDim:"#78350f",danger:"#ef4444",dangerDim:"#7f1d1d",
  info:"#3b82f6",infoDim:"#1e3a5f",
  text:"#e2e8f0",textDim:"#94a3b8",textMuted:"#64748b",headerBg:"#0f1923",
};
const baseBtn={border:"none",borderRadius:6,cursor:"pointer",fontWeight:600,fontFamily:"inherit",transition:"all 0.15s"};
const tableStyle={width:"100%",borderCollapse:"collapse",fontSize:12,fontFamily:"inherit"};
const thStyle={padding:"10px 12px",textAlign:"left",borderBottom:"2px solid "+C.border,color:C.textMuted,fontSize:10,textTransform:"uppercase",letterSpacing:1,background:C.headerBg,position:"sticky",top:0,zIndex:1};
const tdStyle={padding:"8px 12px",borderBottom:"1px solid "+C.border,color:C.text};

const Badge=({children,color="info"})=>{const m={info:[C.infoDim,C.info],warn:[C.warnDim,C.warn],danger:[C.dangerDim,C.danger],success:[C.accentDim,C.accentBright]};const[bg,fg]=m[color]||m.info;return <span style={{background:bg,color:fg,padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700}}>{children}</span>;};
const StatCard=({label,value,sub,color,icon})=>(<div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:8,padding:"18px 20px",flex:1,minWidth:170}}><div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:1.2,marginBottom:6,display:"flex",alignItems:"center",gap:6}}>{icon&&<span>{icon}</span>}{label}</div><div style={{fontSize:24,fontWeight:700,color:color||C.text,fontFamily:"inherit"}}>{value}</div>{sub&&<div style={{fontSize:12,color:C.textDim,marginTop:4}}>{sub}</div>}</div>);
const Input=({label,value,onChange,type="text",style:s={},placeholder,disabled})=>(<div style={{display:"flex",flexDirection:"column",gap:4,...s}}>{label&&<label style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:1}}>{label}</label>}<input type={type} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} style={{background:disabled?C.bg:C.surfaceAlt,border:"1px solid "+C.border,borderRadius:6,padding:"8px 12px",color:disabled?C.textMuted:C.text,fontSize:13,outline:"none",fontFamily:"inherit"}} /></div>);

export default function ADGPayrollDashboard(){
  const[tab,setTab]=useState("dashboard");
  const[config,setConfig]=useState(DEFAULT_CONFIG);
  const[contractors,setContractors]=useState(DEFAULT_CONTRACTORS);
  const[nameMap,setNameMap]=useState({});
  const[timeEntries,setTimeEntries]=useState([]);
  const[auditLog,setAuditLog]=useState([]);
  const[importPreview,setImportPreview]=useState(null);
  const[columnMapping,setColumnMapping]=useState({});
  const[parseErrors,setParseErrors]=useState([]);

  const log=useCallback((action,detail)=>{setAuditLog(prev=>[{ts:new Date().toISOString(),action,detail,id:uid()},...prev.slice(0,199)]);},[]);

  const parseFile=useCallback(async(file)=>{
    const ext=file.name.split(".").pop().toLowerCase();
    let rawRows=[],headers=[];
    if(ext==="csv"||ext==="txt"){
      const text=await file.text();const lines=text.split(/\r?\n/).filter(l=>l.trim());
      if(lines.length<2)return{error:"File has no data rows."};
      const delim=lines[0].includes("\t")?"\t":",";
      headers=lines[0].split(delim).map(h=>h.trim().replace(/^["']|["']$/g,""));
      rawRows=lines.slice(1).map(line=>{const vals=[];let inQ=false,cur="";for(const ch of line){if(ch==='"')inQ=!inQ;else if(ch===delim[0]&&!inQ){vals.push(cur.trim());cur="";}else cur+=ch;}vals.push(cur.trim());return vals;});
    }else if(ext==="xlsx"||ext==="xls"){
      try{const XLSX=await import("xlsx");const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});const ws=wb.Sheets[wb.SheetNames[0]];const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});if(data.length<2)return{error:"No data rows."};headers=data[0].map(h=>String(h).trim());rawRows=data.slice(1).map(r=>r.map(v=>String(v??"").trim()));}catch(e){return{error:"Failed to parse Excel: "+e.message};}
    }else return{error:"Unsupported: ."+ext+". Use .csv .txt .xlsx .xls"};
    const mapping={};const unmapped=[];
    headers.forEach((h,i)=>{const key=matchCol(h,COL_ALIASES);if(key)mapping[i]=key;else unmapped.push({index:i,header:h});});
    const previewRows=rawRows.slice(0,200).map((vals,ri)=>{const row={};headers.forEach((h,i)=>{row["col_"+i]=vals[i]||"";});row._rowIndex=ri;return row;});
    return{headers,mapping,unmapped,previewRows,totalRows:rawRows.length,rawRows,fileName:file.name};
  },[]);

  const handleFileSelect=useCallback(async(e,source)=>{
    const file=e.target.files?.[0];if(!file)return;e.target.value="";
    const result=await parseFile(file);
    if(result.error){setParseErrors([result.error]);return;}
    setImportPreview({...result,source});setColumnMapping(result.mapping);setParseErrors([]);setTab("import");
    log("FILE_LOADED",file.name+" — "+result.totalRows+" rows, "+result.headers.length+" columns");
  },[parseFile,log]);

  const confirmImport=useCallback(()=>{
    if(!importPreview)return;const{rawRows,source}=importPreview;const map=columnMapping;
    const colFor=(key)=>{for(const[idx,k]of Object.entries(map)){if(k===key)return parseInt(idx);}return -1;};
    const errors=[],entries=[],seen=new Set();
    rawRows.forEach((vals,ri)=>{
      let name="";const ni=colFor("name"),fi=colFor("firstName"),li=colFor("lastName");
      if(ni>=0)name=vals[ni]||"";else if(li>=0&&fi>=0)name=(vals[li]+", "+vals[fi]).trim();else if(fi>=0)name=vals[fi]||"";
      if(!name||name===","){errors.push("Row "+(ri+2)+": No name — skipped");return;}
      const rH=parseFloat(vals[colFor("regHours")]||0)||0,oH=parseFloat(vals[colFor("otHours")]||0)||0,pd=parseFloat(vals[colFor("perDiem")]||0)||0;
      const rate=parseFloat(vals[colFor("payRate")]||0)||0,job=vals[colFor("jobTitle")]||"",client=vals[colFor("client")]||source||"";
      const we=vals[colFor("weekEnding")]||config.weekEnding,wid=vals[colFor("workerId")]||"",dept=vals[colFor("department")]||"";
      if(rH===0&&oH===0&&pd===0){errors.push("Row "+(ri+2)+": "+name+" zero hours/per diem — skipped");return;}
      const dupKey=name+"|"+we+"|"+rH+"|"+oH+"|"+pd;
      if(seen.has(dupKey)){errors.push("Row "+(ri+2)+": DUPLICATE "+name+" — skipped");return;}seen.add(dupKey);
      const existDup=timeEntries.some(te=>te.importedName===name&&te.weekEnding===we&&te.regHours===rH&&te.otHours===oH&&te.perDiem===pd);
      if(existDup){errors.push("Row "+(ri+2)+": "+name+" already exists — skipped");return;}
      entries.push({id:uid(),weekEnding:we,source,importedName:name,regHours:rH,otHours:oH,perDiem:pd,payRate:rate,jobTitle:job,client,workerId:wid,department:dept});
    });
    const newMaps={...nameMap};
    entries.forEach(e=>{
      const exact=contractors.some(c=>c.name===e.importedName);
      if(!exact&&!newMaps.hasOwnProperty(e.importedName)){
        const f=fuzzyName(e.importedName,contractors);
        newMaps[e.importedName]=f&&f.confidence>=75?f.match:"";
      }
    });
    setNameMap(newMaps);setTimeEntries(prev=>[...prev,...entries]);setParseErrors(errors);setImportPreview(null);
    log("IMPORT_CONFIRMED",source+": "+entries.length+" added, "+errors.length+" skipped");
    if(errors.length===0)setTab("review");
  },[importPreview,columnMapping,config.weekEnding,contractors,nameMap,timeEntries,log]);

  const normalized=useMemo(()=>timeEntries.map(e=>{
    const stdName=nameMap[e.importedName]||e.importedName;
    const contractor=contractors.find(c=>c.name===stdName);
    const rc=RATE_CARD.find(r=>r.title===(contractor?.jobTitle||e.jobTitle));
    const payREG=contractor?.payREG||e.payRate||0,payOT=contractor?.payOT||(payREG*1.5);
    const billREG=contractor?.billREG||rc?.billREG||0,billOT=contractor?.billOT||rc?.billOT||0;
    const regHrs=e.regHours||0,otHrs=e.otHours||0,perDiem=e.perDiem||contractor?.perDiemDefault||0;
    const payrollTotal=(payREG*regHrs)+(payOT*otHrs)+perDiem,billingTotal=(billREG*regHrs)+(billOT*otHrs);
    return{...e,stdName,workerId:contractor?.workerId||e.workerId||"",jobTitle:contractor?.jobTitle||e.jobTitle||"",payREG,payOT,billREG,billOT,regHrs,otHrs,perDiem,payrollTotal,billingTotal,client:contractor?.client||e.client||e.source||""};
  }),[timeEntries,nameMap,contractors]);

  const weekEntries=useMemo(()=>normalized.filter(e=>e.weekEnding===config.weekEnding),[normalized,config.weekEnding]);
  const weekPayroll=weekEntries.reduce((s,e)=>s+e.payrollTotal,0);
  const weekBilling=weekEntries.reduce((s,e)=>s+e.billingTotal,0);
  const weekMargin=weekBilling-weekPayroll;
  const weekMarginPct=weekBilling>0?weekMargin/weekBilling:0;
  const ytdPayroll=normalized.reduce((s,e)=>s+e.payrollTotal,0);
  const ytdBilling=normalized.reduce((s,e)=>s+e.billingTotal,0);
  const ytdMargin=ytdBilling-ytdPayroll,ytdMarginPct=ytdBilling>0?ytdMargin/ytdBilling:0;

  const validationIssues=useMemo(()=>{
    const issues=[];
    weekEntries.forEach(e=>{
      if(!e.workerId)issues.push({severity:"error",name:e.stdName,msg:"Missing Paychex Worker ID — Paychex will reject this row"});
      if(e.payREG===0&&e.regHrs>0)issues.push({severity:"error",name:e.stdName,msg:"REG pay rate is $0.00 — worker won't be paid for regular hours"});
      if(e.payOT===0&&e.otHrs>0)issues.push({severity:"error",name:e.stdName,msg:"OT pay rate is $0.00 — worker won't be paid for overtime"});
      if(e.regHrs>config.otThreshold)issues.push({severity:"warn",name:e.stdName,msg:"REG hours ("+e.regHrs+") exceed "+config.otThreshold+"hr OT threshold — verify OT split"});
      if(e.regHrs+e.otHrs>80)issues.push({severity:"warn",name:e.stdName,msg:"Total hours ("+(e.regHrs+e.otHrs).toFixed(1)+") exceed 80 — possible duplicate"});
      if(e.otHrs>0&&e.regHrs<config.otThreshold)issues.push({severity:"warn",name:e.stdName,msg:"OT reported but REG below "+config.otThreshold+"hrs — confirm OT is legitimate"});
      if(e.billREG===0&&e.regHrs>0)issues.push({severity:"warn",name:e.stdName,msg:"Bill rate REG is $0 — no revenue for this work"});
      if(nameMap.hasOwnProperty(e.importedName)&&nameMap[e.importedName]==="")issues.push({severity:"error",name:e.importedName,msg:"Imported name not matched to any contractor"});
    });
    const ww={};weekEntries.forEach(e=>{const k=e.stdName+"|"+e.weekEnding;ww[k]=(ww[k]||0)+1;});
    Object.entries(ww).forEach(([k,count])=>{if(count>1)issues.push({severity:"warn",name:k.split("|")[0],msg:"Appears "+count+" times — possible duplicate"});});
    return issues;
  },[weekEntries,config.otThreshold,nameMap]);

  const errs=validationIssues.filter(i=>i.severity==="error");
  const warns=validationIssues.filter(i=>i.severity==="warn");
  const exportReady=errs.length===0&&weekEntries.length>0;

  const generatePaychexRows=useCallback(()=>{
    const rows=[];const s=toDateStr(weekStart(config.weekEnding)),en=toDateStr(config.weekEnding);
    weekEntries.forEach(e=>{
      if(e.regHrs>0)rows.push([config.companyId,e.workerId,config.payComponentREG,e.payREG.toFixed(2),e.regHrs.toFixed(2),(e.payREG*e.regHrs).toFixed(2),"",s,en]);
      if(e.otHrs>0)rows.push([config.companyId,e.workerId,config.payComponentOT,e.payOT.toFixed(2),e.otHrs.toFixed(2),(e.payOT*e.otHrs).toFixed(2),"",s,en]);
      if(e.perDiem>0)rows.push([config.companyId,e.workerId,config.payComponentPerDiem,e.perDiem.toFixed(2),"1.00",e.perDiem.toFixed(2),"",s,en]);
    });return rows;
  },[weekEntries,config]);

  const downloadPaychex=useCallback(()=>{
    const rows=generatePaychexRows();if(rows.length===0)return;
    const csv=rows.map(r=>r.join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="Paychex_SPI_WE"+config.weekEnding.replace(/-/g,"")+".csv";a.click();URL.revokeObjectURL(url);
    log("EXPORT_PAYCHEX",rows.length+" line items for WE "+config.weekEnding);
  },[generatePaychexRows,config.weekEnding,log]);

  const downloadQB=useCallback(()=>{
    const header="Customer,Invoice Date,Due Date,Product/Service,Description,Qty,Rate,Amount";
    const rows=weekEntries.filter(e=>e.billingTotal>0).map(e=>{
      const desc=e.stdName+" - "+e.jobTitle+" - WE "+config.weekEnding;
      const d=new Date(config.weekEnding+"T12:00:00");const due=new Date(d);due.setDate(due.getDate()+30);
      return[e.client,toDateStr(config.weekEnding),toDateStr(due.toISOString().split("T")[0]),"Staffing Services",'"'+desc+'"',(e.regHrs+e.otHrs).toFixed(2),e.billREG.toFixed(2),e.billingTotal.toFixed(2)].join(",");
    });if(rows.length===0)return;
    const csv=header+"\n"+rows.join("\n");const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="QB_Invoice_WE"+config.weekEnding.replace(/-/g,"")+".csv";a.click();URL.revokeObjectURL(url);
    log("EXPORT_QB",rows.length+" invoice lines");
  },[weekEntries,config.weekEnding,log]);

  const updateEntry=useCallback((id,field,value)=>{setTimeEntries(prev=>prev.map(e=>e.id===id?{...e,[field]:value}:e));log("EDIT","Updated "+field+" on "+id);},[log]);
  const deleteEntry=useCallback((id)=>{const e=timeEntries.find(x=>x.id===id);setTimeEntries(prev=>prev.filter(x=>x.id!==id));log("DELETE","Removed "+(e?.importedName||id));},[timeEntries,log]);

  const[manual,setManual]=useState({name:"",regHours:"",otHours:"",perDiem:""});
  const addManual=()=>{if(!manual.name)return;setTimeEntries(prev=>[...prev,{id:uid(),weekEnding:config.weekEnding,source:"Manual",importedName:manual.name,regHours:parseFloat(manual.regHours)||0,otHours:parseFloat(manual.otHours)||0,perDiem:parseFloat(manual.perDiem)||0,payRate:0,jobTitle:"",client:"",workerId:"",department:""}]);setManual({name:"",regHours:"",otHours:"",perDiem:""});log("MANUAL","Added "+manual.name);};

  const clientBreakdown=useMemo(()=>{const m={};weekEntries.forEach(e=>{if(!m[e.client])m[e.client]={payroll:0,billing:0,count:0};m[e.client].payroll+=e.payrollTotal;m[e.client].billing+=e.billingTotal;m[e.client].count++;});return m;},[weekEntries]);
  const unmatchedCount=Object.entries(nameMap).filter(([k,v])=>v==="").length;

  const TabBtn=({id,label,icon,badge:b})=>(<button onClick={()=>setTab(id)} style={{...baseBtn,padding:"10px 16px",fontSize:13,display:"flex",alignItems:"center",gap:6,background:tab===id?C.accent:"transparent",color:tab===id?"#000":C.textDim,borderBottom:tab===id?"2px solid "+C.accentBright:"2px solid transparent"}}>{icon} {label}{b>0&&<span style={{background:tab===id?"#000":C.danger,color:tab===id?C.accent:"#fff",borderRadius:10,padding:"1px 6px",fontSize:10,fontWeight:700}}>{b}</span>}</button>);

  // ═══ DASHBOARD ═══
  const renderDashboard=()=>(<div style={{display:"flex",flexDirection:"column",gap:20}}>
    {(errs.length>0||warns.length>0)&&weekEntries.length>0&&(<div style={{background:errs.length>0?C.dangerDim:C.warnDim,border:"1px solid "+(errs.length>0?C.danger:C.warn),borderRadius:10,padding:16}}>
      <div style={{fontWeight:700,fontSize:14,color:errs.length>0?C.danger:C.warn,marginBottom:8}}>{errs.length>0?"\u26d4 "+errs.length+" Error"+(errs.length>1?"s":"")+" \u2014 Export Blocked":"\u26a0 "+warns.length+" Warning"+(warns.length>1?"s":"")}</div>
      {errs.slice(0,5).map((e,i)=><div key={i} style={{fontSize:12,color:C.text,padding:"2px 0"}}>{"\u2022"} <strong>{e.name}:</strong> {e.msg}</div>)}
      {warns.slice(0,3).map((w,i)=><div key={i} style={{fontSize:12,color:C.textDim,padding:"2px 0"}}>{"\u2022"} <strong>{w.name}:</strong> {w.msg}</div>)}
    </div>)}
    <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
      <StatCard icon="\ud83d\udcc5" label="Week Ending" value={config.weekEnding} sub={weekEntries.length+" entries"} />
      <StatCard icon={exportReady?"\u2705":"\ud83d\udeab"} label="Export Status" value={exportReady?"READY":"NOT READY"} color={exportReady?C.accent:C.danger} sub={errs.length+" errors, "+warns.length+" warnings"} />
      <StatCard icon="\ud83c\udfaf" label="Margin" value={weekMarginPct>=config.targetMargin?"ON TARGET":"BELOW"} color={weekMarginPct>=config.targetMargin?C.accent:C.warn} sub={"Target: "+fmtPct(config.targetMargin)} />
    </div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
      <StatCard label="Weekly Payroll" value={fmt(weekPayroll)} color={C.info} />
      <StatCard label="Weekly Billing" value={fmt(weekBilling)} color={C.accent} />
      <StatCard label="Margin $" value={fmt(weekMargin)} color={weekMargin>=0?C.accent:C.danger} />
      <StatCard label="Margin %" value={fmtPct(weekMarginPct)} color={weekMarginPct>=config.targetMargin?C.accent:C.warn} />
    </div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
      <StatCard label="YTD Payroll" value={fmt(ytdPayroll)} /><StatCard label="YTD Billing" value={fmt(ytdBilling)} />
      <StatCard label="YTD Margin $" value={fmt(ytdMargin)} color={ytdMargin>=0?C.accent:C.danger} /><StatCard label="YTD %" value={fmtPct(ytdMarginPct)} />
    </div>
    {Object.keys(clientBreakdown).length>0&&(<div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:20}}>
      <h3 style={{margin:"0 0 12px",color:C.accent,fontSize:14}}>Revenue by Client</h3>
      <table style={tableStyle}><thead><tr>{["Client","Workers","Payroll","Billing","Profit","Margin %"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>
        {Object.entries(clientBreakdown).map(([cl,d])=>{const p=d.billing-d.payroll;const m=d.billing>0?p/d.billing:0;return<tr key={cl}><td style={{...tdStyle,fontWeight:600}}>{cl||"\u2014"}</td><td style={tdStyle}>{d.count}</td><td style={tdStyle}>{fmt(d.payroll)}</td><td style={tdStyle}>{fmt(d.billing)}</td><td style={{...tdStyle,color:p>=0?C.accent:C.danger}}>{fmt(p)}</td><td style={{...tdStyle,color:m>=config.targetMargin?C.accent:C.warn}}>{fmtPct(m)}</td></tr>;})}
      </tbody></table></div>)}
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
      <button onClick={downloadPaychex} disabled={!exportReady} style={{...baseBtn,padding:"14px 28px",background:exportReady?C.accent:C.textMuted,color:exportReady?"#000":"#666",fontSize:14,opacity:exportReady?1:0.5}}>{"\u2b07"} Export Paychex SPI CSV</button>
      <button onClick={downloadQB} disabled={weekEntries.length===0} style={{...baseBtn,padding:"14px 28px",background:weekEntries.length>0?C.info:C.textMuted,color:"#fff",fontSize:14,opacity:weekEntries.length>0?1:0.5}}>{"\u2b07"} Export QB Invoice CSV</button>
      {!exportReady&&weekEntries.length>0&&<span style={{fontSize:12,color:C.danger}}>Fix {errs.length} error{errs.length!==1?"s":""} before exporting</span>}
    </div>
    {weekEntries.length===0&&(<div style={{background:C.surfaceAlt,border:"1px dashed "+C.border,borderRadius:10,padding:40,textAlign:"center"}}><div style={{fontSize:16,color:C.textDim,marginBottom:8}}>No data for this pay period</div><div style={{fontSize:13,color:C.textMuted}}>Upload a CSV or Excel file from the Import tab</div></div>)}
  </div>);

  // ═══ IMPORT ═══
  const renderImport=()=>(<div style={{display:"flex",flexDirection:"column",gap:20}}>
    <div style={{background:C.surface,border:"2px dashed "+C.border,borderRadius:12,padding:40,textAlign:"center"}}>
      <div style={{fontSize:36,marginBottom:12}}>{"\ud83d\udcc2"}</div>
      <div style={{fontSize:16,fontWeight:600,color:C.text,marginBottom:6}}>Drop or browse a payroll file</div>
      <div style={{fontSize:12,color:C.textMuted,marginBottom:20}}>Supports .csv .txt .xlsx .xls — auto-detects columns</div>
      <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
        {["OneVision","RedOak","Other"].map(src=>(<label key={src} style={{...baseBtn,display:"inline-flex",alignItems:"center",gap:6,padding:"12px 24px",background:src==="OneVision"?C.accent:src==="RedOak"?C.info:C.surfaceAlt,color:src==="Other"?C.text:"#000",fontSize:13,cursor:"pointer"}}>{"\ud83d\udcc4"} {src}<input type="file" accept=".csv,.txt,.xlsx,.xls" style={{display:"none"}} onChange={e=>handleFileSelect(e,src)} /></label>))}
      </div>
    </div>
    {importPreview&&(<div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div><h3 style={{margin:0,color:C.accent,fontSize:14}}>Column Mapping — {importPreview.fileName}</h3><p style={{margin:"4px 0 0",fontSize:12,color:C.textMuted}}>{importPreview.totalRows} rows. Map columns below.</p></div>
        <div style={{display:"flex",gap:8}}><button onClick={()=>setImportPreview(null)} style={{...baseBtn,padding:"8px 16px",background:C.surfaceAlt,color:C.textDim,fontSize:12}}>Cancel</button><button onClick={confirmImport} style={{...baseBtn,padding:"8px 20px",background:C.accent,color:"#000",fontSize:13}}>{"\u2713"} Confirm Import</button></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10,marginBottom:16}}>
        {importPreview.headers.map((h,i)=>(<div key={i} style={{background:C.surfaceAlt,borderRadius:6,padding:"8px 12px"}}><div style={{fontSize:10,color:C.textMuted,marginBottom:4}}>Col {i+1}: <span style={{color:C.text}}>{h}</span></div><select value={columnMapping[i]||""} onChange={e=>{const m={...columnMapping};if(e.target.value)m[i]=e.target.value;else delete m[i];setColumnMapping(m);}} style={{width:"100%",background:C.bg,border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:columnMapping[i]?C.accent:C.textMuted,fontSize:11}}><option value="">{"\u2014"} skip {"\u2014"}</option>{Object.keys(COL_ALIASES).map(k=><option key={k} value={k}>{k}</option>)}</select></div>))}
      </div>
      <div style={{overflow:"auto",maxHeight:300}}><table style={tableStyle}><thead><tr>{importPreview.headers.map((h,i)=><th key={i} style={{...thStyle,color:columnMapping[i]?C.accent:C.textMuted,fontSize:9}}>{columnMapping[i]?"\u2713 "+columnMapping[i]:h}</th>)}</tr></thead><tbody>
        {importPreview.previewRows.slice(0,10).map((r,ri)=>(<tr key={ri}>{importPreview.headers.map((h,i)=><td key={i} style={{...tdStyle,fontSize:11,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r["col_"+i]}</td>)}</tr>))}
      </tbody></table></div>
    </div>)}
    {parseErrors.length>0&&(<div style={{background:C.surface,border:"1px solid "+C.warn,borderRadius:10,padding:16}}><h4 style={{margin:"0 0 8px",color:C.warn,fontSize:13}}>Import Notes ({parseErrors.length})</h4><div style={{maxHeight:200,overflow:"auto"}}>{parseErrors.map((e,i)=><div key={i} style={{fontSize:11,color:C.textDim,padding:"2px 0"}}>{e}</div>)}</div></div>)}
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:20}}>
      <h3 style={{margin:"0 0 14px",color:C.accent,fontSize:14}}>Quick Add (Manual)</h3>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"end"}}>
        <div style={{flex:2,minWidth:200}}><label style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:4}}>Contractor</label><select value={manual.name} onChange={e=>setManual(p=>({...p,name:e.target.value}))} style={{background:C.surfaceAlt,border:"1px solid "+C.border,borderRadius:6,padding:"8px 12px",color:C.text,fontSize:13,width:"100%"}}><option value="">Select...</option>{contractors.filter(c=>c.active).map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></div>
        <Input label="REG Hrs" type="number" value={manual.regHours} onChange={e=>setManual(p=>({...p,regHours:e.target.value}))} style={{flex:1,minWidth:90}} />
        <Input label="OT Hrs" type="number" value={manual.otHours} onChange={e=>setManual(p=>({...p,otHours:e.target.value}))} style={{flex:1,minWidth:90}} />
        <Input label="Per Diem" type="number" value={manual.perDiem} onChange={e=>setManual(p=>({...p,perDiem:e.target.value}))} style={{flex:1,minWidth:90}} />
        <button onClick={addManual} style={{...baseBtn,padding:"8px 20px",background:C.accent,color:"#000",fontSize:13,height:36}}>+ Add</button>
      </div>
    </div>
  </div>);

  // ═══ REVIEW ═══
  const renderReview=()=>(<div style={{display:"flex",flexDirection:"column",gap:16}}>
    {validationIssues.length>0&&(<div style={{background:C.surface,border:"1px solid "+(errs.length>0?C.danger:C.warn),borderRadius:10,padding:16}}>
      <div style={{display:"flex",gap:16,marginBottom:12}}>{errs.length>0&&<Badge color="danger">{errs.length} ERROR{errs.length>1?"S":""}</Badge>}{warns.length>0&&<Badge color="warn">{warns.length} WARNING{warns.length>1?"S":""}</Badge>}</div>
      <div style={{maxHeight:200,overflow:"auto"}}>{validationIssues.map((v,i)=><div key={i} style={{fontSize:11,color:v.severity==="error"?C.danger:C.warn,padding:"3px 0"}}>{v.severity==="error"?"\u26d4":"\u26a0"} <strong>{v.name}:</strong> {v.msg}</div>)}</div>
    </div>)}
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,overflow:"auto",maxHeight:600}}>
      {weekEntries.length===0?(<div style={{padding:40,textAlign:"center",color:C.textMuted}}>No entries for {config.weekEnding}.</div>):(
      <table style={tableStyle}><thead><tr>{["","Name","Worker ID","Client","Job Title","REG Hrs","OT Hrs","Per Diem","Pay Total","Bill Total",""].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>
        {weekEntries.map((e,i)=>{const hasErr=errs.some(er=>er.name===e.stdName||er.name===e.importedName);const hasWarn=warns.some(w=>w.name===e.stdName||w.name===e.importedName);
          return(<tr key={e.id} style={{background:hasErr?C.dangerDim+"33":hasWarn?C.warnDim+"33":i%2===0?"transparent":C.surfaceAlt}}>
            <td style={{...tdStyle,width:24,textAlign:"center"}}>{hasErr?<span style={{color:C.danger}}>{"\u26d4"}</span>:hasWarn?<span style={{color:C.warn}}>{"\u26a0"}</span>:<span style={{color:C.accent}}>{"\u2713"}</span>}</td>
            <td style={{...tdStyle,fontWeight:600,minWidth:160}}>{e.stdName}{e.stdName!==e.importedName&&<div style={{fontSize:10,color:C.textMuted}}>{"\u2190"} {e.importedName}</div>}</td>
            <td style={tdStyle}><input value={e.workerId} onChange={ev=>updateEntry(e.id,"workerId",ev.target.value)} style={{background:"transparent",border:"1px solid "+(!e.workerId?C.danger:C.border),borderRadius:4,padding:"4px 6px",color:C.text,width:80,fontSize:11,fontFamily:"inherit"}} placeholder="Required" /></td>
            <td style={{...tdStyle,fontSize:11}}>{e.client}</td><td style={{...tdStyle,fontSize:11}}>{e.jobTitle}</td>
            <td style={tdStyle}><input type="number" step="0.5" value={e.regHours} onChange={ev=>updateEntry(e.id,"regHours",parseFloat(ev.target.value)||0)} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:60,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>
            <td style={tdStyle}><input type="number" step="0.5" value={e.otHours} onChange={ev=>updateEntry(e.id,"otHours",parseFloat(ev.target.value)||0)} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:60,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>
            <td style={tdStyle}><input type="number" step="1" value={e.perDiem} onChange={ev=>updateEntry(e.id,"perDiem",parseFloat(ev.target.value)||0)} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:70,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>
            <td style={{...tdStyle,textAlign:"right",color:C.info,fontWeight:600}}>{fmt(e.payrollTotal)}</td>
            <td style={{...tdStyle,textAlign:"right",color:C.accent,fontWeight:600}}>{fmt(e.billingTotal)}</td>
            <td style={tdStyle}><button onClick={()=>deleteEntry(e.id)} style={{...baseBtn,padding:"3px 8px",background:"transparent",color:C.danger,fontSize:11}}>{"\u2715"}</button></td>
          </tr>);})}
        <tr style={{background:C.headerBg}}><td style={tdStyle}></td><td colSpan={4} style={{...tdStyle,fontWeight:700,color:C.accent}}>TOTALS ({weekEntries.length} workers)</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700}}>{weekEntries.reduce((s,e)=>s+e.regHrs,0).toFixed(2)}</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700}}>{weekEntries.reduce((s,e)=>s+e.otHrs,0).toFixed(2)}</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700}}>{fmt(weekEntries.reduce((s,e)=>s+e.perDiem,0))}</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700,color:C.info}}>{fmt(weekPayroll)}</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700,color:C.accent}}>{fmt(weekBilling)}</td><td style={tdStyle}></td></tr>
      </tbody></table>)}
    </div>
  </div>);

  // ═══ NAME MATCH ═══
  const renderNameMatch=()=>{const entries=Object.entries(nameMap);return(<div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:24}}>
    <h3 style={{margin:"0 0 6px",color:C.accent,fontSize:14}}>Name Matching</h3>
    <p style={{fontSize:12,color:C.textMuted,margin:"0 0 16px"}}>Auto-matched with fuzzy logic. Fix any mismatches.{unmatchedCount>0&&<span style={{color:C.danger,fontWeight:700}}> {unmatchedCount} unmatched.</span>}</p>
    {entries.length===0?(<div style={{color:C.textMuted,fontSize:13,padding:20,textAlign:"center"}}>No mappings yet. Import data first.</div>):(
    <table style={tableStyle}><thead><tr><th style={thStyle}>Imported Name</th><th style={thStyle}>Matched Contractor</th><th style={thStyle}>Status</th><th style={thStyle}></th></tr></thead><tbody>
      {entries.map(([imported,standard])=>(<tr key={imported}>
        <td style={{...tdStyle,fontWeight:600,color:!standard?C.danger:C.warn}}>{imported}</td>
        <td style={tdStyle}><select value={standard} onChange={e=>{setNameMap(p=>({...p,[imported]:e.target.value}));log("NAME_MAP",imported+" \u2192 "+e.target.value);}} style={{background:C.surfaceAlt,border:"1px solid "+(!standard?C.danger:C.border),borderRadius:4,padding:"6px 10px",color:C.text,fontSize:12,width:"100%"}}><option value="">{"\u2014"} NOT MATCHED {"\u2014"}</option>{contractors.map(c=><option key={c.name} value={c.name}>{c.name}</option>)}</select></td>
        <td style={tdStyle}>{standard?<Badge color="success">MATCHED</Badge>:<Badge color="danger">UNMATCHED</Badge>}</td>
        <td style={tdStyle}><button onClick={()=>{const m={...nameMap};delete m[imported];setNameMap(m);}} style={{...baseBtn,padding:"3px 8px",background:"transparent",color:C.textMuted,fontSize:11}}>{"\u2715"}</button></td>
      </tr>))}
    </tbody></table>)}
  </div>);};

  // ═══ CONTRACTORS ═══
  const renderContractors=()=>(<div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,overflow:"auto",maxHeight:600}}>
    <table style={tableStyle}><thead><tr>{["Name","Worker ID","Client","Dept","Job Title","Pay REG","Pay OT","Bill REG","Bill OT","Per Diem","Active"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>
      {contractors.map((c,i)=>(<tr key={i} style={{background:i%2===0?"transparent":C.surfaceAlt,opacity:c.active?1:0.5}}>
        <td style={{...tdStyle,fontWeight:600,minWidth:170}}>{c.name}</td>
        <td style={tdStyle}><input value={c.workerId} onChange={e=>{const u=[...contractors];u[i]={...u[i],workerId:e.target.value};setContractors(u);}} style={{background:"transparent",border:"1px solid "+(!c.workerId?C.warn:C.border),borderRadius:4,padding:"4px 6px",color:C.text,width:80,fontSize:11,fontFamily:"inherit"}} placeholder="Required" /></td>
        {["client","location"].map(f=><td key={f} style={tdStyle}><input value={c[f]} onChange={e=>{const u=[...contractors];u[i]={...u[i],[f]:e.target.value};setContractors(u);}} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:"100%",fontSize:11,fontFamily:"inherit"}} /></td>)}
        <td style={tdStyle}><select value={c.jobTitle} onChange={e=>{const u=[...contractors];const rc=RATE_CARD.find(r=>r.title===e.target.value);u[i]={...u[i],jobTitle:e.target.value,billREG:rc?.billREG||0,billOT:rc?.billOT||0};setContractors(u);}} style={{background:C.surfaceAlt,border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,fontSize:11}}>{RATE_CARD.map(r=><option key={r.title} value={r.title}>{r.title}</option>)}</select></td>
        {["payREG","payOT","billREG","billOT","perDiemDefault"].map(f=><td key={f} style={tdStyle}><input type="number" step="0.01" value={c[f]} onChange={e=>{const u=[...contractors];u[i]={...u[i],[f]:parseFloat(e.target.value)||0};setContractors(u);}} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:65,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>)}
        <td style={tdStyle}><button onClick={()=>{const u=[...contractors];u[i]={...u[i],active:!u[i].active};setContractors(u);}} style={{...baseBtn,padding:"4px 10px",fontSize:11,background:c.active?C.accentDim:C.surfaceAlt,color:c.active?C.accentBright:C.textMuted}}>{c.active?"Y":"N"}</button></td>
      </tr>))}
    </tbody></table>
  </div>);

  // ═══ SETUP ═══
  const renderSetup=()=>(<div style={{display:"flex",flexDirection:"column",gap:24}}>
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:24}}>
      <h3 style={{margin:"0 0 16px",color:C.accent,fontSize:14}}>Paychex Configuration</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Input label="Week Ending" type="date" value={config.weekEnding} onChange={e=>setConfig(p=>({...p,weekEnding:e.target.value}))} />
        <Input label="Company ID" value={config.companyId} onChange={e=>setConfig(p=>({...p,companyId:e.target.value}))} />
        <Input label="Pay Component REG (case-sensitive)" value={config.payComponentREG} onChange={e=>setConfig(p=>({...p,payComponentREG:e.target.value}))} />
        <Input label="Pay Component OT (case-sensitive)" value={config.payComponentOT} onChange={e=>setConfig(p=>({...p,payComponentOT:e.target.value}))} />
        <Input label="Pay Component Per Diem (case-sensitive)" value={config.payComponentPerDiem} onChange={e=>setConfig(p=>({...p,payComponentPerDiem:e.target.value}))} />
        <Input label="Target Margin %" type="number" value={(config.targetMargin*100).toFixed(0)} onChange={e=>setConfig(p=>({...p,targetMargin:parseFloat(e.target.value)/100}))} />
        <Input label="OT Threshold (hours)" type="number" value={config.otThreshold} onChange={e=>setConfig(p=>({...p,otThreshold:parseFloat(e.target.value)||40}))} />
      </div>
    </div>
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:24}}>
      <h3 style={{margin:"0 0 6px",color:C.accent,fontSize:14}}>Rate Card</h3>
      <table style={tableStyle}><thead><tr>{["Job Title","Bill REG","Bill OT"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>
        {RATE_CARD.map((r,i)=>(<tr key={i} style={{background:i%2===0?"transparent":C.surfaceAlt}}><td style={{...tdStyle,fontWeight:600}}>{r.title}</td><td style={{...tdStyle,textAlign:"right"}}>{fmt(r.billREG)}</td><td style={{...tdStyle,textAlign:"right"}}>{fmt(r.billOT)}</td></tr>))}
      </tbody></table>
    </div>
  </div>);

  // ═══ EXPORT PREVIEW ═══
  const renderExport=()=>{const rows=generatePaychexRows();return(<div style={{display:"flex",flexDirection:"column",gap:16}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
      <div><h3 style={{margin:0,color:C.accent,fontSize:14}}>Paychex SPI Export Preview</h3><p style={{margin:"4px 0 0",fontSize:12,color:C.textMuted}}>{rows.length} lines {"\u2022"} WE {config.weekEnding} {"\u2022"} Co {config.companyId}</p></div>
      <button onClick={downloadPaychex} disabled={!exportReady} style={{...baseBtn,padding:"10px 24px",background:exportReady?C.accent:C.textMuted,color:exportReady?"#000":"#666",fontSize:13}}>{"\u2b07"} Download CSV</button>
    </div>
    {!exportReady&&errs.length>0&&(<div style={{background:C.dangerDim,border:"1px solid "+C.danger,borderRadius:8,padding:12}}><div style={{fontSize:12,color:C.danger,fontWeight:700}}>{"\u26d4"} Export blocked {"\u2014"} {errs.length} error{errs.length>1?"s":""}</div>{errs.map((e,i)=><div key={i} style={{fontSize:11,color:C.text,padding:"2px 0"}}>{"\u2022"} {e.name}: {e.msg}</div>)}</div>)}
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,overflow:"auto",maxHeight:500}}>
      {rows.length===0?(<div style={{padding:40,textAlign:"center",color:C.textMuted}}>No data.</div>):(
      <table style={tableStyle}><thead><tr>{["Company ID","Worker ID","Pay Component","Rate","Hours","Amount","Seq #","Start","End"].map(h=><th key={h} style={thStyle}>{h}</th>)}</tr></thead><tbody>
        {rows.map((r,i)=>(<tr key={i} style={{background:i%2===0?"transparent":C.surfaceAlt}}>{r.map((v,j)=><td key={j} style={{...tdStyle,textAlign:j>=3&&j<=5?"right":"left",color:j===1&&!v?C.danger:C.text}}>{v||<span style={{color:C.danger}}>MISSING</span>}</td>)}</tr>))}
      </tbody></table>)}
    </div>
    <div style={{background:C.surfaceAlt,border:"1px solid "+C.border,borderRadius:8,padding:16}}>
      <div style={{fontSize:11,color:C.warn,fontWeight:700,marginBottom:6}}>PAYCHEX SPI FORMAT</div>
      <div style={{fontSize:11,color:C.textDim,lineHeight:1.6}}>Fixed-order CSV, no header row. Each row = one earning component per worker. Upload via Paychex Flex: Payroll {"\u2192"} Active {"\u2192"} Browse Files. Pay components are case-sensitive.</div>
    </div>
  </div>);};

  // ═══ AUDIT ═══
  const renderAudit=()=>(<div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:20}}>
    <h3 style={{margin:"0 0 12px",color:C.accent,fontSize:14}}>Audit Trail</h3>
    <p style={{fontSize:11,color:C.textMuted,margin:"0 0 16px"}}>Every import, edit, delete, and export is logged.</p>
    {auditLog.length===0?(<div style={{color:C.textMuted,fontSize:13,padding:20,textAlign:"center"}}>No activity yet.</div>):(
    <div style={{maxHeight:500,overflow:"auto"}}>{auditLog.map(l=>(<div key={l.id} style={{display:"flex",gap:12,padding:"6px 0",borderBottom:"1px solid "+C.border,fontSize:11}}>
      <span style={{color:C.textMuted,minWidth:70,flexShrink:0}}>{new Date(l.ts).toLocaleTimeString()}</span>
      <Badge color={l.action.includes("ERROR")?"danger":l.action.includes("DELETE")?"warn":"info"}>{l.action}</Badge>
      <span style={{color:C.textDim}}>{l.detail}</span>
    </div>))}</div>)}
  </div>);

  // ═══ SHELL ═══
  return(<div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:"'JetBrains Mono','Fira Code',monospace"}}>
    <div style={{background:C.headerBg,borderBottom:"1px solid "+C.border,padding:"14px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
      <div><div style={{fontSize:18,fontWeight:700,color:C.accent,letterSpacing:-0.5}}>ADG STAFFING</div><div style={{fontSize:11,color:C.textMuted}}>Payroll Consolidation {"\u2192"} Paychex SPI Export</div></div>
      <div style={{display:"flex",alignItems:"center",gap:16}}>
        <div style={{textAlign:"right"}}><div style={{fontSize:10,color:C.textMuted}}>Week Ending</div><div style={{fontSize:14,fontWeight:600}}>{config.weekEnding}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:10,color:C.textMuted}}>Entries</div><div style={{fontSize:14,fontWeight:600,color:weekEntries.length>0?C.accent:C.textMuted}}>{weekEntries.length}</div></div>
        <div style={{width:10,height:10,borderRadius:"50%",background:exportReady?C.accent:errs.length>0?C.danger:C.textMuted,boxShadow:exportReady?"0 0 8px "+C.accent:"none"}} />
      </div>
    </div>
    <div style={{background:C.headerBg,borderBottom:"1px solid "+C.border,padding:"0 12px",display:"flex",gap:2,overflowX:"auto"}}>
      <TabBtn id="dashboard" label="Dashboard" icon={"\ud83d\udcca"} badge={errs.length} />
      <TabBtn id="import" label="Import" icon={"\ud83d\udce5"} />
      <TabBtn id="namematch" label="Names" icon={"\ud83d\udd17"} badge={unmatchedCount} />
      <TabBtn id="review" label="Review" icon={"\u270f\ufe0f"} badge={warns.length} />
      <TabBtn id="contractors" label="Contractors" icon={"\ud83d\udc77"} />
      <TabBtn id="export" label="Export" icon={"\u2705"} />
      <TabBtn id="setup" label="Setup" icon={"\u2699"} />
      <TabBtn id="audit" label="Audit" icon={"\ud83d\udccb"} />
    </div>
    <div style={{padding:"20px 24px",maxWidth:1440,margin:"0 auto"}}>
      {tab==="dashboard"&&renderDashboard()}
      {tab==="import"&&renderImport()}
      {tab==="namematch"&&renderNameMatch()}
      {tab==="review"&&renderReview()}
      {tab==="contractors"&&renderContractors()}
      {tab==="export"&&renderExport()}
      {tab==="setup"&&renderSetup()}
      {tab==="audit"&&renderAudit()}
    </div>
  </div>);
}
