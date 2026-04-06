"use client";
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { detectClient, parseKingAerospace, parseBombardier, parseRedOak } from "../lib/clientParsers";
import { extractPDFText } from "../lib/pdfExtractor";

const STORAGE_KEY = "adg_payroll_v2";
const PROFILES_KEY  = "adg_client_profiles_v1";

const DEFAULT_CONFIG = {
  companyId: "70157401",
  payComponentREG: "Hourly",
  payComponentOT: "Overtime reg amt",
  payComponentDT: "Double Time",
  payComponentPerDiem: "Per Diem Non Tax",
  targetMargin: 0.30,
  weekEnding: new Date().toISOString().split("T")[0],
  otThreshold: 40,
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
  // Red Oak (Qarbon) — bill rates from their Excel file
  { name:"Edwards, Renado",  workerId:"500569", client:"Red Oak", location:"", jobTitle:"A&P Mechanic", payREG:0, payOT:0, billREG:52,   billOT:78,    perDiemDefault:0, active:true },
  { name:"Huffman, Ginger",  workerId:"500550", client:"Red Oak", location:"", jobTitle:"Bonder",       payREG:0, payOT:0, billREG:45.5, billOT:68.25, perDiemDefault:0, active:true },
  { name:"Lemons, Dinah",    workerId:"500573", client:"Red Oak", location:"", jobTitle:"Bonder",       payREG:0, payOT:0, billREG:45.5, billOT:68.25, perDiemDefault:0, active:true },
  // Bombardier Hartford
  { name:"Williams, Gemel", workerId:"4000090", client:"Bombardier Hartford", location:"", jobTitle:"A&P Mechanic", payREG:0, payOT:0, billREG:0, billOT:0, perDiemDefault:0, active:true },
  // King Aerospace
  { name:"Grimmet, Jonnie", workerId:"", client:"King Aerospace", location:"", jobTitle:"A&P Mechanic", payREG:0, payOT:0, billREG:0, billOT:0, perDiemDefault:0, active:true },
  // Other contractors
  ...[
    "Ariza, Roberto","Blanco, Jerson","Bonilla, Fernando","Centeno Lafaurie, Oscar Jose",
    "Chan, Allan","Cordova, Marco","Coronado, Christian","Cortes, Gustavo","Donado, Delmar",
    "Fanney, Dominique","Goosetree, Donald","Hoang, Dianna","Hurtado, Daniel",
    "McCarrell, Stacy","Olaya, Jhon","Ortiz, Nelson","Pujols, Ariam","Rabeiro, Osmel",
    "Ramsey, Bryson","Reyes, Mario","Schofield, Liam","Tran, Tuan","Zabala, Arbenys",
  ].map(name => ({ name, workerId:"", client:"", location:"", jobTitle:"A&P Mechanic", payREG:0, payOT:0, billREG:0, billOT:0, perDiemDefault:0, active:true })),
];

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

// ── GENERIC COLUMN-MAP PARSER (for unknown client files) ──
function applyGenericMap(rows,headers,fieldMap){
  const entries=[];
  for(const row of rows){
    let name="";
    const idx=(f)=>f?headers.indexOf(f):-1;
    if(fieldMap.name&&idx(fieldMap.name)>=0){name=String(row[idx(fieldMap.name)]??"").trim();}
    else if(fieldMap.firstName&&fieldMap.lastName&&idx(fieldMap.firstName)>=0&&idx(fieldMap.lastName)>=0){
      const fn=String(row[idx(fieldMap.firstName)]??"").trim();
      const ln=String(row[idx(fieldMap.lastName)]??"").trim();
      name=ln?`${ln}, ${fn}`:fn;
    }
    if(!name)continue;
    const getNum=(f)=>idx(f)>=0?parseFloat(row[idx(f)])||0:0;
    const regHours=getNum(fieldMap.regHours),otHours=getNum(fieldMap.otHours),perDiem=getNum(fieldMap.perDiem);
    if(regHours===0&&otHours===0)continue;
    entries.push({name,regHours,otHours,perDiem,status:"complete",weekEnding:""});
  }
  return entries;
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
  const[loaded,setLoaded]=useState(false);
  const[tab,setTab]=useState("dashboard");
  const[config,setConfig]=useState(DEFAULT_CONFIG);
  const[contractors,setContractors]=useState(DEFAULT_CONTRACTORS);
  const[nameMap,setNameMap]=useState({});
  const[timeEntries,setTimeEntries]=useState([]);
  const[auditLog,setAuditLog]=useState([]);
  const[importQueue,setImportQueue]=useState([]);      // multi-file upload queue
  const[parseErrors,setParseErrors]=useState([]);
  const[lastSaved,setLastSaved]=useState(null);
  const[clientProfiles,setClientProfiles]=useState({}); // saved generic client column maps
  const[mappingForms,setMappingForms]=useState({});     // in-progress mapper state per item

  // ── LOAD from localStorage on first render ──
  useEffect(()=>{
    try{
      const saved=localStorage.getItem(STORAGE_KEY);
      if(saved){
        const d=JSON.parse(saved);
        if(d.config)setConfig(p=>({...p,...d.config}));
        if(d.contractors?.length)setContractors(d.contractors);
        if(d.timeEntries?.length)setTimeEntries(d.timeEntries);
        if(d.nameMap)setNameMap(d.nameMap);
        if(d.auditLog?.length)setAuditLog(d.auditLog);
      }
      const savedProfiles=localStorage.getItem(PROFILES_KEY);
      if(savedProfiles)setClientProfiles(JSON.parse(savedProfiles));
    }catch(e){console.error("Load error",e);}
    setLoaded(true);
  },[]);

  // ── AUTO-SAVE to localStorage on every change ──
  useEffect(()=>{
    if(!loaded)return;
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify({config,contractors,timeEntries,nameMap,auditLog}));
      setLastSaved(new Date());
    }catch(e){console.error("Save error",e);}
  },[loaded,config,contractors,timeEntries,nameMap,auditLog]);

  // ── SAVE client profiles when they change ──
  useEffect(()=>{
    if(!loaded)return;
    try{localStorage.setItem(PROFILES_KEY,JSON.stringify(clientProfiles));}catch(e){}
  },[loaded,clientProfiles]);

  const log=useCallback((action,detail)=>{setAuditLog(prev=>[{ts:new Date().toISOString(),action,detail,id:uid()},...prev.slice(0,499)]);},[]);

  // ── BACKUP: download full data as JSON for Teams ──
  const exportBackup=useCallback(()=>{
    const data={config,contractors,timeEntries,nameMap,auditLog,exportedAt:new Date().toISOString()};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;
    a.download="ADG_Payroll_Backup_"+new Date().toISOString().slice(0,10)+".json";
    a.click();URL.revokeObjectURL(url);
    log("BACKUP_EXPORT","Full backup downloaded");
  },[config,contractors,timeEntries,nameMap,auditLog,log]);

  // ── RESTORE: load JSON backup from Teams ──
  const importBackup=useCallback((file)=>{
    if(!file)return;
    const reader=new FileReader();
    reader.onload=(e)=>{
      try{
        const d=JSON.parse(e.target.result);
        if(d.config)setConfig(p=>({...p,...d.config}));
        if(d.contractors?.length)setContractors(d.contractors);
        if(d.timeEntries?.length)setTimeEntries(d.timeEntries);
        if(d.nameMap)setNameMap(d.nameMap);
        if(d.auditLog?.length)setAuditLog(d.auditLog);
        log("BACKUP_IMPORT","Restored from "+file.name);
      }catch(err){alert("Could not read backup file: "+err.message);}
    };
    reader.readAsText(file);
  },[log]);

  // ── MULTI-FILE UPLOAD HANDLER ──
  const handleFilesSelect=useCallback(async(filesOrEvent,forcedSource)=>{
    const rawList=filesOrEvent?.target?.files??filesOrEvent;
    if(!rawList||rawList.length===0)return;
    const files=Array.from(rawList); // snapshot before clearing
    if(filesOrEvent?.target)filesOrEvent.target.value="";
    setParseErrors([]);
    const fileMap={};
    const newItems=files.map(file=>{
      const id=uid();fileMap[id]=file;
      return{id,fileName:file.name,status:"parsing",client:forcedSource||null,entries:[],error:null,rawHeaders:null,rawRows:null,invoiceAmount:0,invoiceNumber:"",invoiceDate:""};
    });
    setImportQueue(prev=>[...prev,...newItems]);
    setTab("import");
    for(const item of newItems){
      const file=fileMap[item.id];
      const ext=file.name.split(".").pop().toLowerCase();
      try{
        if(ext==="pdf"){
          const text=await extractPDFText(file);
          const client=forcedSource||detectClient(text,file.name);
          if(!client){setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"error",error:"Could not auto-detect client. Use a client card below to force the source."}:q));continue;}
          if(client==="King Aerospace"){
            const entries=parseKingAerospace(text);
            if(!entries.length){setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"error",error:"No timecard data found in this PDF."}:q));continue;}
            setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"ready",client,entries}:q));
          }else if(client==="Bombardier Hartford"){
            const{entries,invoiceAmount,invoiceNumber,invoiceDate}=parseBombardier(text);
            if(!entries.length){setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"error",error:"No employee table found in Bombardier PDF."}:q));continue;}
            setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"ready",client,entries,invoiceAmount,invoiceNumber,invoiceDate}:q));
          }
          log("FILE_LOADED",file.name+" \u2192 "+client);
        }else if(ext==="xlsx"||ext==="xls"||ext==="csv"){
          const XLSX=await import("xlsx");
          let data;
          if(ext==="csv"){const text=await file.text();const wb=XLSX.read(text,{type:"string"});data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""});}
          else{const buf=await file.arrayBuffer();const wb=XLSX.read(buf,{type:"array"});data=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1,defval:""});}
          if(data.length<2){setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"error",error:"File has no data rows."}:q));continue;}
          const rawHeaders=data[0].map(h=>String(h).trim());
          const rawRows=data.slice(1).filter(r=>r.some(v=>v!==""&&v!==null));
          if(forcedSource==="Red Oak"||(!forcedSource&&detectClient("",file.name)==="Red Oak")){
            const entries=parseRedOak(rawRows,rawHeaders);
            if(!entries.length){setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"error",error:"No valid rows found in Excel file."}:q));continue;}
            setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"ready",client:"Red Oak",entries}:q));
            log("FILE_LOADED",file.name+" ("+entries.length+" entries)");continue;
          }
          const profileKey=forcedSource||(Object.keys(clientProfiles).find(cName=>clientProfiles[cName].filePatterns?.some(p=>file.name.toLowerCase().includes(p.toLowerCase())))||null);
          if(profileKey&&clientProfiles[profileKey]){
            const entries=applyGenericMap(rawRows,rawHeaders,clientProfiles[profileKey].fieldMap);
            if(entries.length){
              setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"ready",client:profileKey,entries}:q));
              log("FILE_LOADED",file.name+" matched saved profile '"+profileKey+"' ("+entries.length+" entries)");continue;
            }
          }
          setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"needs_mapping",rawHeaders,rawRows,client:forcedSource||""}:q));
          setMappingForms(prev=>({...prev,[item.id]:{clientName:forcedSource||"",fieldMap:{name:"",regHours:"",otHours:"",perDiem:""},saveProfile:true}}));
        }else{
          setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"error",error:"Unsupported file type. Use PDF, Excel (.xlsx), or CSV."}:q));
        }
      }catch(err){
        setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"error",error:"Error reading file: "+err.message}:q));
      }
    }
  },[log,clientProfiles]);

  const removeFromQueue=useCallback((id)=>{
    setImportQueue(prev=>prev.filter(q=>q.id!==id));
    setMappingForms(prev=>{const n={...prev};delete n[id];return n;});
  },[]);

  const applyMapping=useCallback((item)=>{
    const form=mappingForms[item.id];
    if(!form?.clientName?.trim()){alert("Please enter a client name.");return;}
    const entries=applyGenericMap(item.rawRows,item.rawHeaders,form.fieldMap);
    if(!entries.length){alert("No valid rows found. Make sure Employee Name and at least one hours column are selected.");return;}
    if(form.saveProfile){
      const pattern=item.fileName.replace(/\d+/g,"").replace(/\.(xlsx?|csv)$/i,"").trim();
      setClientProfiles(prev=>({...prev,[form.clientName]:{fieldMap:form.fieldMap,filePatterns:[...new Set([...(prev[form.clientName]?.filePatterns||[]),pattern])]}}));
    }
    setImportQueue(prev=>prev.map(q=>q.id===item.id?{...q,status:"ready",client:form.clientName,entries}:q));
    log("COLUMN_MAP",item.fileName+" mapped as '"+form.clientName+"' ("+entries.length+" entries)");
  },[mappingForms,log]);

  const confirmQueueItem=useCallback((item)=>{
    if(!item||item.status!=="ready")return;
    const{entries,client}=item;
    const newEntries=[],errors=[],newMaps={...nameMap};
    for(const entry of entries){
      const isDup=timeEntries.some(te=>te.importedName===entry.name&&te.weekEnding===(entry.weekEnding||config.weekEnding)&&te.regHours===entry.regHours&&te.otHours===entry.otHours);
      if(isDup){errors.push(entry.name+": already imported \u2014 skipped");continue;}
      newEntries.push({id:uid(),weekEnding:entry.weekEnding||config.weekEnding,source:client,importedName:entry.name,regHours:entry.regHours||0,otHours:entry.otHours||0,dtHours:entry.dtHours||0,perDiem:entry.perDiem||0,payRate:0,billREG:entry.billREG||0,billOT:entry.billOT||0,invoiceAmount:entry.invoiceAmount||0,invoiceNumber:entry.invoiceNumber||"",daysWorked:entry.daysWorked||0,status:entry.status||"complete",workerId:"",department:"",jobTitle:"",client:""});
      const exact=contractors.some(c=>c.name===entry.name);
      if(!exact&&!newMaps.hasOwnProperty(entry.name)){const f=fuzzyName(entry.name,contractors);newMaps[entry.name]=f&&f.confidence>=75?f.match:"";}
    }
    setTimeEntries(prev=>[...prev,...newEntries]);
    setNameMap(newMaps);
    if(errors.length)setParseErrors(prev=>[...prev,...errors]);
    removeFromQueue(item.id);
    log("IMPORT_CONFIRMED",client+": "+newEntries.length+" added, "+errors.length+" skipped");
    if(errors.length===0&&newEntries.length>0)setTab("review");
  },[nameMap,timeEntries,config.weekEnding,contractors,removeFromQueue,log]);

  const confirmAllReady=useCallback(()=>{
    const readyItems=importQueue.filter(q=>q.status==="ready");
    if(!readyItems.length)return;
    let allNew=[],allErrors=[],newMaps={...nameMap};
    for(const item of readyItems){
      for(const entry of item.entries){
        const isDup=[...timeEntries,...allNew].some(te=>te.importedName===entry.name&&te.weekEnding===(entry.weekEnding||config.weekEnding)&&te.regHours===entry.regHours&&te.otHours===entry.otHours);
        if(isDup){allErrors.push(entry.name+": already imported \u2014 skipped");continue;}
        allNew.push({id:uid(),weekEnding:entry.weekEnding||config.weekEnding,source:item.client,importedName:entry.name,regHours:entry.regHours||0,otHours:entry.otHours||0,dtHours:entry.dtHours||0,perDiem:entry.perDiem||0,payRate:0,billREG:entry.billREG||0,billOT:entry.billOT||0,invoiceAmount:entry.invoiceAmount||0,invoiceNumber:entry.invoiceNumber||"",daysWorked:entry.daysWorked||0,status:entry.status||"complete",workerId:"",department:"",jobTitle:"",client:""});
        const exact=contractors.some(c=>c.name===entry.name);
        if(!exact&&!newMaps.hasOwnProperty(entry.name)){const f=fuzzyName(entry.name,contractors);newMaps[entry.name]=f&&f.confidence>=75?f.match:"";}
      }
    }
    setTimeEntries(prev=>[...prev,...allNew]);
    setNameMap(newMaps);
    setParseErrors(allErrors);
    setImportQueue(prev=>prev.filter(q=>q.status!=="ready"));
    log("IMPORT_ALL",readyItems.length+" files, "+allNew.length+" entries added");
    if(allErrors.length===0)setTab("review");
  },[importQueue,nameMap,timeEntries,config.weekEnding,contractors,log]);

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
      if(e.payREG===0&&e.regHrs>0)issues.push({severity:"warn",name:e.stdName,msg:"REG pay rate not set — add rate in Contractors tab before exporting"});
      if(e.payOT===0&&e.otHrs>0)issues.push({severity:"warn",name:e.stdName,msg:"OT pay rate not set — add rate in Contractors tab before exporting"});
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
  const renderImport=()=>{
    const needsHours=weekEntries.filter(e=>e.status==="needs_hours");
    const readyCount=importQueue.filter(q=>q.status==="ready").length;
    const mappingCount=importQueue.filter(q=>q.status==="needs_mapping").length;
    const selectStyle={background:C.surfaceAlt,border:"1px solid "+C.border,borderRadius:4,padding:"6px 10px",color:C.text,fontSize:12,width:"100%"};

    return(<div style={{display:"flex",flexDirection:"column",gap:20}}>

    {/* ── SMART DROPZONE ── */}
    <label
      style={{background:"linear-gradient(135deg,"+C.surface+","+C.surfaceAlt+")",border:"2px dashed "+C.accent,borderRadius:16,padding:"36px 28px",textAlign:"center",cursor:"pointer",display:"block",transition:"all 0.2s"}}
      onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.accentBright;e.currentTarget.style.background=C.accentDim+"33";}}
      onDragLeave={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.background="linear-gradient(135deg,"+C.surface+","+C.surfaceAlt+")";}}
      onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.background="linear-gradient(135deg,"+C.surface+","+C.surfaceAlt+")";handleFilesSelect(e.dataTransfer.files);}}
    >
      <div style={{fontSize:36,marginBottom:8}}>📂</div>
      <div style={{fontWeight:700,color:C.accent,fontSize:16,marginBottom:4}}>Smart Upload — Drop Files Here</div>
      <div style={{fontSize:12,color:C.textDim,marginBottom:14}}>Drop multiple PDF, Excel, or CSV files at once. The system auto-detects clients.</div>
      <div style={{display:"inline-block",background:C.accent,color:"#000",padding:"10px 28px",borderRadius:8,fontSize:13,fontWeight:700}}>Browse Files</div>
      <input type="file" accept=".pdf,.xlsx,.xls,.csv" multiple style={{display:"none"}} onChange={e=>handleFilesSelect(e)} />
    </label>

    {/* ── UPLOAD QUEUE ── */}
    {importQueue.length>0&&(<div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:12,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div>
          <h3 style={{margin:0,color:C.accent,fontSize:14}}>Upload Queue ({importQueue.length} file{importQueue.length!==1?"s":""})</h3>
          <p style={{margin:"4px 0 0",fontSize:11,color:C.textMuted}}>{readyCount} ready · {mappingCount} need mapping</p>
        </div>
        {readyCount>0&&<button onClick={confirmAllReady} style={{...baseBtn,padding:"10px 24px",background:C.accent,color:"#000",fontSize:13,fontWeight:700}}>✓ Import All Ready ({readyCount})</button>}
      </div>
      {importQueue.map(item=>(
        <div key={item.id} style={{background:item.status==="error"?C.dangerDim+"22":item.status==="needs_mapping"?C.warnDim+"22":item.status==="ready"?C.accentDim+"22":"transparent",border:"1px solid "+(item.status==="error"?C.danger:item.status==="needs_mapping"?C.warn:item.status==="ready"?C.accent:C.border),borderRadius:8,padding:14,marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:200}}>
              <span style={{fontSize:18}}>{item.status==="ready"?"✅":item.status==="error"?"❌":item.status==="needs_mapping"?"🔧":item.status==="parsing"?"⏳":"📄"}</span>
              <div>
                <div style={{fontWeight:600,fontSize:13,color:C.text}}>{item.fileName}</div>
                <div style={{fontSize:11,color:C.textMuted}}>
                  {item.status==="ready"&&<span style={{color:C.accent}}>{item.client} — {item.entries.length} entries ready</span>}
                  {item.status==="error"&&<span style={{color:C.danger}}>{item.error}</span>}
                  {item.status==="needs_mapping"&&<span style={{color:C.warn}}>Unknown format — map columns below</span>}
                  {item.status==="parsing"&&<span>Processing...</span>}
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {item.status==="ready"&&<button onClick={()=>confirmQueueItem(item)} style={{...baseBtn,padding:"6px 16px",background:C.accent,color:"#000",fontSize:12}}>✓ Import</button>}
              <button onClick={()=>removeFromQueue(item.id)} style={{...baseBtn,padding:"6px 10px",background:"transparent",color:C.danger,fontSize:14}}>✕</button>
            </div>
          </div>

          {/* ── COLUMN MAPPER (inline for needs_mapping items) ── */}
          {item.status==="needs_mapping"&&mappingForms[item.id]&&(
            <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid "+C.border}}>
              <div style={{fontWeight:700,color:C.warn,fontSize:12,marginBottom:10}}>🔧 Map Columns for This File</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                <div>
                  <label style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}}>Client Name *</label>
                  <input value={mappingForms[item.id].clientName} onChange={ev=>setMappingForms(p=>({...p,[item.id]:{...p[item.id],clientName:ev.target.value}}))} placeholder="e.g. Boeing, Gulfstream" style={{...selectStyle,border:"1px solid "+(mappingForms[item.id].clientName?"#243044":C.danger)}} />
                </div>
                <div>
                  <label style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}}>Employee Name Column *</label>
                  <select value={mappingForms[item.id].fieldMap.name} onChange={ev=>setMappingForms(p=>({...p,[item.id]:{...p[item.id],fieldMap:{...p[item.id].fieldMap,name:ev.target.value}}}))} style={selectStyle}>
                    <option value="">— Select —</option>
                    {item.rawHeaders.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}}>REG Hours Column *</label>
                  <select value={mappingForms[item.id].fieldMap.regHours} onChange={ev=>setMappingForms(p=>({...p,[item.id]:{...p[item.id],fieldMap:{...p[item.id].fieldMap,regHours:ev.target.value}}}))} style={selectStyle}>
                    <option value="">— Select —</option>
                    {item.rawHeaders.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}}>OT Hours Column</label>
                  <select value={mappingForms[item.id].fieldMap.otHours} onChange={ev=>setMappingForms(p=>({...p,[item.id]:{...p[item.id],fieldMap:{...p[item.id].fieldMap,otHours:ev.target.value}}}))} style={selectStyle}>
                    <option value="">— None —</option>
                    {item.rawHeaders.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:3}}>Per Diem Column</label>
                  <select value={mappingForms[item.id].fieldMap.perDiem} onChange={ev=>setMappingForms(p=>({...p,[item.id]:{...p[item.id],fieldMap:{...p[item.id].fieldMap,perDiem:ev.target.value}}}))} style={selectStyle}>
                    <option value="">— None —</option>
                    {item.rawHeaders.map(h=><option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div style={{display:"flex",alignItems:"end",gap:8}}>
                  <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.textDim,cursor:"pointer"}}>
                    <input type="checkbox" checked={mappingForms[item.id].saveProfile} onChange={ev=>setMappingForms(p=>({...p,[item.id]:{...p[item.id],saveProfile:ev.target.checked}}))} />
                    Remember for next time
                  </label>
                </div>
              </div>
              {item.rawHeaders.length>0&&(
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:10,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>Preview (first 3 rows)</div>
                  <div style={{overflow:"auto",maxHeight:120,background:C.bg,borderRadius:6,padding:8}}>
                    <table style={{...tableStyle,fontSize:10}}><thead><tr>{item.rawHeaders.map(h=><th key={h} style={{...thStyle,fontSize:9,padding:"4px 6px"}}>{h}</th>)}</tr></thead>
                    <tbody>{item.rawRows.slice(0,3).map((r,ri)=><tr key={ri}>{r.map((v,vi)=><td key={vi} style={{...tdStyle,padding:"3px 6px",fontSize:10}}>{String(v??"")}</td>)}</tr>)}</tbody></table>
                  </div>
                </div>
              )}
              <button onClick={()=>applyMapping(item)} style={{...baseBtn,padding:"8px 20px",background:C.accent,color:"#000",fontSize:12,fontWeight:700}}>✓ Apply Mapping</button>
            </div>
          )}
        </div>
      ))}
    </div>)}

    {/* ── CLIENT CARDS ── */}
    {(()=>{
      const uploadedClients={};
      weekEntries.forEach(e=>{const src=e.source||e.client||"";if(src)uploadedClients[src]=(uploadedClients[src]||0)+1;});
      const cardStyle=(clr,name)=>{const has=uploadedClients[name];return{background:has?C.accentDim+"22":C.surface,border:"1px solid "+(has?C.accent:clr?clr+"44":C.border),borderRadius:10,padding:16,textAlign:"center",cursor:"pointer",display:"block",boxShadow:has?"0 0 12px "+C.accent+"44":"none",transition:"all 0.2s",position:"relative"};};
      const uploadBadge=(name)=>{const count=uploadedClients[name];if(!count)return null;return <div style={{background:C.accent,color:"#000",fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:10,position:"absolute",top:6,right:6}}>✓ {count}</div>;};
      return(
      <div>
        <div style={{fontSize:11,color:C.textMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>Client Upload Cards ({3+Object.keys(clientProfiles).length})</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12}}>
          <label style={cardStyle(C.accent,"King Aerospace")}>
            {uploadBadge("King Aerospace")}
            <div style={{fontSize:22,marginBottom:4}}>🛩️</div>
            <div style={{fontWeight:700,color:C.accent,fontSize:12}}>King Aerospace</div>
            <div style={{fontSize:10,color:uploadedClients["King Aerospace"]?C.accent:C.textMuted}}>{uploadedClients["King Aerospace"]?"✓ Uploaded":"PDF timecard"}</div>
            <input type="file" accept=".pdf" style={{display:"none"}} onChange={e=>handleFilesSelect(e,"King Aerospace")} />
          </label>
          <label style={cardStyle(C.info,"Bombardier Hartford")}>
            {uploadBadge("Bombardier Hartford")}
            <div style={{fontSize:22,marginBottom:4}}>✈️</div>
            <div style={{fontWeight:700,color:C.info,fontSize:12}}>Bombardier Hartford</div>
            <div style={{fontSize:10,color:uploadedClients["Bombardier Hartford"]?C.accent:C.textMuted}}>{uploadedClients["Bombardier Hartford"]?"✓ Uploaded":"PDF invoice"}</div>
            <input type="file" accept=".pdf" style={{display:"none"}} onChange={e=>handleFilesSelect(e,"Bombardier Hartford")} />
          </label>
          <label style={cardStyle(C.warn,"Red Oak")}>
            {uploadBadge("Red Oak")}
            <div style={{fontSize:22,marginBottom:4}}>📊</div>
            <div style={{fontWeight:700,color:C.warn,fontSize:12}}>Red Oak (Qarbon)</div>
            <div style={{fontSize:10,color:uploadedClients["Red Oak"]?C.accent:C.textMuted}}>{uploadedClients["Red Oak"]?"✓ Uploaded":"Excel spreadsheet"}</div>
            <input type="file" accept=".xlsx,.xls" style={{display:"none"}} onChange={e=>handleFilesSelect(e,"Red Oak")} />
          </label>
          {/* Dynamic cards from saved client profiles */}
          {Object.entries(clientProfiles).map(([name],idx)=>{
            const colors=["#8b5cf6","#ec4899","#06b6d4","#f97316","#14b8a6","#a855f7","#eab308","#6366f1"];
            const clr=colors[idx%colors.length];
            return(
            <label key={name} style={cardStyle(clr,name)}>
              {uploadBadge(name)}
              <div style={{fontSize:22,marginBottom:4}}>🏢</div>
              <div style={{fontWeight:700,color:clr,fontSize:12}}>{name}</div>
              <div style={{fontSize:10,color:uploadedClients[name]?C.accent:C.textMuted}}>{uploadedClients[name]?"✓ Uploaded":"Excel / CSV"}</div>
              <input type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={e=>handleFilesSelect(e,name)} />
            </label>);
          })}
        </div>
      </div>);
    })()}

    {/* ── SAVED CLIENT PROFILES ── */}
    {Object.keys(clientProfiles).length>0&&(
      <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:16}}>
        <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:10}}>💾 Saved Client Profiles</div>
        <div style={{fontSize:11,color:C.textMuted,marginBottom:10}}>These client column mappings are remembered. Files matching these patterns are auto-processed.</div>
        <table style={tableStyle}><thead><tr>{["Client Name","Name Col","REG Col","OT Col",""].map(h=><th key={h} style={{...thStyle,fontSize:9}}>{h}</th>)}</tr></thead>
        <tbody>{Object.entries(clientProfiles).map(([name,prof])=>(
          <tr key={name}><td style={{...tdStyle,fontWeight:600}}>{name}</td><td style={tdStyle}>{prof.fieldMap.name||"—"}</td><td style={tdStyle}>{prof.fieldMap.regHours||"—"}</td><td style={tdStyle}>{prof.fieldMap.otHours||"—"}</td>
          <td style={tdStyle}><button onClick={()=>{if(window.confirm("Delete saved profile for '"+name+"'?"))setClientProfiles(p=>{const n={...p};delete n[name];return n;});}} style={{...baseBtn,padding:"3px 8px",background:"transparent",color:C.danger,fontSize:11}}>✕</button></td></tr>
        ))}</tbody></table>
      </div>
    )}

    {/* ── BOMBARDIER HOURS-NEEDED ALERT ── */}
    {needsHours.length>0&&(<div style={{background:C.warnDim,border:"1px solid "+C.warn,borderRadius:10,padding:20}}>
      <div style={{fontWeight:700,color:C.warn,fontSize:14,marginBottom:10}}>⚠️ {needsHours.length} Bombardier {needsHours.length===1?"Entry Needs":"Entries Need"} Hours</div>
      <p style={{fontSize:12,color:C.textDim,marginBottom:14}}>Bombardier's PDF doesn't include individual hours. Please fill in REG and OT hours for each worker below, then go to Review.</p>
      {needsHours.map(e=>(<div key={e.id} style={{display:"flex",gap:12,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
        <span style={{flex:2,minWidth:160,fontWeight:600,fontSize:13}}>{e.importedName}</span>
        <span style={{fontSize:11,color:C.textMuted}}>Days: {e.daysWorked} | WE: {e.weekEnding}</span>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <label style={{fontSize:11,color:C.textMuted}}>REG hrs</label>
          <input type="number" step="0.5" min="0" defaultValue={0}
            onBlur={ev=>updateEntry(e.id,"regHours",parseFloat(ev.target.value)||0)}
            style={{width:70,background:C.surfaceAlt,border:"1px solid "+C.warn,borderRadius:4,padding:"4px 8px",color:C.text,fontSize:12,fontFamily:"inherit"}} />
          <label style={{fontSize:11,color:C.textMuted}}>OT hrs</label>
          <input type="number" step="0.5" min="0" defaultValue={0}
            onBlur={ev=>updateEntry(e.id,"otHours",parseFloat(ev.target.value)||0)}
            style={{width:70,background:C.surfaceAlt,border:"1px solid "+C.border,borderRadius:4,padding:"4px 8px",color:C.text,fontSize:12,fontFamily:"inherit"}} />
          <button onClick={()=>updateEntry(e.id,"status","complete")} style={{...baseBtn,padding:"4px 12px",background:C.accent,color:"#000",fontSize:11}}>✓ Done</button>
        </div>
      </div>))}
    </div>)}

    {/* ── PARSE ERRORS ── */}
    {parseErrors.length>0&&(<div style={{background:C.surface,border:"1px solid "+C.warn,borderRadius:10,padding:16}}><h4 style={{margin:"0 0 8px",color:C.warn,fontSize:13}}>Import Notes ({parseErrors.length})</h4><div style={{maxHeight:200,overflow:"auto"}}>{parseErrors.map((e,i)=><div key={i} style={{fontSize:11,color:C.textDim,padding:"2px 0"}}>{e}</div>)}</div></div>)}

    {/* ── QUICK ADD (MANUAL) ── */}
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
  };

  // ═══ REVIEW ═══
  const renderReview=()=>(<div style={{display:"flex",flexDirection:"column",gap:16}}>
    {validationIssues.length>0&&(<div style={{background:C.surface,border:"1px solid "+(errs.length>0?C.danger:C.warn),borderRadius:10,padding:16}}>
      <div style={{display:"flex",gap:16,marginBottom:12}}>{errs.length>0&&<Badge color="danger">{errs.length} ERROR{errs.length>1?"S":""}</Badge>}{warns.length>0&&<Badge color="warn">{warns.length} WARNING{warns.length>1?"S":""}</Badge>}</div>
      <div style={{maxHeight:200,overflow:"auto"}}>{validationIssues.map((v,i)=><div key={i} style={{fontSize:11,color:v.severity==="error"?C.danger:C.warn,padding:"3px 0"}}>{v.severity==="error"?"\u26d4":"\u26a0"} <strong>{v.name}:</strong> {v.msg}</div>)}</div>
    </div>)}
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,overflow:"auto",maxHeight:600}}>
      {weekEntries.length===0?(<div style={{padding:40,textAlign:"center",color:C.textMuted}}>No entries for {config.weekEnding}.</div>):(
      <table style={tableStyle}><thead><tr>
        {[["","center"],["Name","left"],["Worker ID","left"],["Client","left"],["Job Title","left"],["REG Hrs","right"],["OT Hrs","right"],["Per Diem","right"],["Pay Total","right"],["Bill Total","right"],["","left"]].map(([h,align],i)=><th key={i} style={{...thStyle,textAlign:align}}>{h}</th>)}
      </tr></thead><tbody>
        {weekEntries.map((e,i)=>{const hasErr=errs.some(er=>er.name===e.stdName||er.name===e.importedName);const hasWarn=warns.some(w=>w.name===e.stdName||w.name===e.importedName);
          return(<tr key={e.id} style={{background:hasErr?C.dangerDim+"33":hasWarn?C.warnDim+"33":i%2===0?"transparent":C.surfaceAlt}}>
            <td style={{...tdStyle,width:24,textAlign:"center"}}>{hasErr?<span style={{color:C.danger}}>{"\u26d4"}</span>:hasWarn?<span style={{color:C.warn}}>{"\u26a0"}</span>:<span style={{color:C.accent}}>{"\u2713"}</span>}</td>
            <td style={{...tdStyle,fontWeight:600,minWidth:160}}>{e.stdName}{e.stdName!==e.importedName&&<div style={{fontSize:10,color:C.textMuted}}>{"\u2190"} {e.importedName}</div>}</td>
            <td style={tdStyle}><input value={e.workerId} onChange={ev=>updateEntry(e.id,"workerId",ev.target.value)} style={{background:"transparent",border:"1px solid "+(!e.workerId?C.danger:C.border),borderRadius:4,padding:"4px 6px",color:C.text,width:80,fontSize:11,fontFamily:"inherit"}} placeholder="Required" /></td>
            <td style={{...tdStyle,fontSize:11}}>{e.client}</td><td style={{...tdStyle,fontSize:11}}>{e.jobTitle}</td>
            <td style={{...tdStyle,textAlign:"right"}}><input type="number" step="0.5" value={e.regHours} onChange={ev=>updateEntry(e.id,"regHours",parseFloat(ev.target.value)||0)} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:60,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>
            <td style={{...tdStyle,textAlign:"right"}}><input type="number" step="0.5" value={e.otHours} onChange={ev=>updateEntry(e.id,"otHours",parseFloat(ev.target.value)||0)} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:60,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>
            <td style={{...tdStyle,textAlign:"right"}}><input type="number" step="1" value={e.perDiem} onChange={ev=>updateEntry(e.id,"perDiem",parseFloat(ev.target.value)||0)} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:70,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>
            <td style={{...tdStyle,textAlign:"right",color:C.info,fontWeight:600}}>{fmt(e.payrollTotal)}</td>
            <td style={{...tdStyle,textAlign:"right",color:C.accent,fontWeight:600}}>{fmt(e.billingTotal)}</td>
            <td style={tdStyle}><button onClick={()=>deleteEntry(e.id)} style={{...baseBtn,padding:"3px 8px",background:"transparent",color:C.danger,fontSize:11}}>{"\u2715"}</button></td>
          </tr>);})}
        <tr style={{background:C.headerBg}}><td style={tdStyle}></td><td colSpan={4} style={{...tdStyle,fontWeight:700,color:C.accent}}>TOTALS ({weekEntries.length} workers)</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700}}>{weekEntries.reduce((s,e)=>s+(e.regHours||0),0).toFixed(2)}</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700}}>{weekEntries.reduce((s,e)=>s+(e.otHours||0),0).toFixed(2)}</td>
          <td style={{...tdStyle,textAlign:"right",fontWeight:700}}>{fmt(weekEntries.reduce((s,e)=>s+(e.perDiem||0),0))}</td>
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
  const renderContractors=()=>{
    const addContractor=()=>{
      const name=prompt("Full name (Last, First):");
      if(!name||!name.trim())return;
      if(contractors.some(c=>c.name.toLowerCase()===name.trim().toLowerCase())){alert("A contractor with that name already exists.");return;}
      setContractors(prev=>[...prev,{
        name:name.trim(),workerId:"",client:"",location:"",
        jobTitle:RATE_CARD[0]?.title||"",
        payREG:0,payOT:0,
        billREG:RATE_CARD[0]?.billREG||0,billOT:RATE_CARD[0]?.billOT||0,
        perDiemDefault:0,active:true
      }]);
    };
    const removeContractor=(i)=>{
      const c=contractors[i];
      if(!window.confirm(`Remove ${c.name} from the roster?\n\nThis will not delete their past payroll history.`))return;
      setContractors(prev=>prev.filter((_,idx)=>idx!==i));
    };
    return(<div style={{display:"flex",flexDirection:"column",gap:16}}>
      {/* Add Contractor */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <h3 style={{margin:"0 0 2px",fontSize:14,color:C.accent}}>Contractor Roster</h3>
          <p style={{margin:0,fontSize:11,color:C.textMuted}}>{contractors.filter(c=>c.active).length} active · {contractors.filter(c=>!c.active).length} inactive</p>
        </div>
        <button onClick={addContractor} style={{...baseBtn,padding:"9px 20px",background:C.accent,color:"#000",fontSize:13,fontWeight:700}}>+ Add Contractor</button>
      </div>
      {/* Table */}
      <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,overflow:"auto"}}>
        <table style={tableStyle}><thead><tr>
          {[["Name","left"],["Worker ID","left"],["Client","left"],["Dept","left"],["Job Title","left"],["Pay REG","right"],["Pay OT","right"],["Bill REG","right"],["Bill OT","right"],["Per Diem","right"],["Active","center"],["","center"]].map(([h,align],i)=><th key={i} style={{...thStyle,textAlign:align}}>{h}</th>)}
        </tr></thead><tbody>
          {contractors.map((c,i)=>(<tr key={i} style={{background:i%2===0?"transparent":C.surfaceAlt,opacity:c.active?1:0.45}}>
            <td style={{...tdStyle,fontWeight:600,minWidth:170}}>{c.name}</td>
            <td style={tdStyle}><input value={c.workerId} onChange={e=>{const u=[...contractors];u[i]={...u[i],workerId:e.target.value};setContractors(u);}} style={{background:"transparent",border:"1px solid "+(!c.workerId?C.warn:C.border),borderRadius:4,padding:"4px 6px",color:C.text,width:80,fontSize:11,fontFamily:"inherit"}} placeholder="Required" /></td>
            {["client","location"].map(f=><td key={f} style={tdStyle}><input value={c[f]} onChange={e=>{const u=[...contractors];u[i]={...u[i],[f]:e.target.value};setContractors(u);}} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:"100%",fontSize:11,fontFamily:"inherit"}} /></td>)}
            <td style={tdStyle}><select value={c.jobTitle} onChange={e=>{const u=[...contractors];const rc=RATE_CARD.find(r=>r.title===e.target.value);u[i]={...u[i],jobTitle:e.target.value,billREG:rc?.billREG||0,billOT:rc?.billOT||0};setContractors(u);}} style={{background:C.surfaceAlt,border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,fontSize:11}}>{RATE_CARD.map(r=><option key={r.title} value={r.title}>{r.title}</option>)}</select></td>
            {["payREG","payOT","billREG","billOT","perDiemDefault"].map(f=><td key={f} style={{...tdStyle,textAlign:"right"}}><input type="number" step="0.01" value={c[f]} onChange={e=>{const u=[...contractors];u[i]={...u[i],[f]:parseFloat(e.target.value)||0};setContractors(u);}} style={{background:"transparent",border:"1px solid "+C.border,borderRadius:4,padding:"4px 6px",color:C.text,width:65,fontSize:11,fontFamily:"inherit",textAlign:"right"}} /></td>)}
            <td style={{...tdStyle,textAlign:"center"}}><button onClick={()=>{const u=[...contractors];u[i]={...u[i],active:!u[i].active};setContractors(u);}} style={{...baseBtn,padding:"4px 10px",fontSize:11,background:c.active?C.accentDim:C.surfaceAlt,color:c.active?C.accentBright:C.textMuted}}>{c.active?"Y":"N"}</button></td>
            <td style={{...tdStyle,textAlign:"center"}}><button onClick={()=>removeContractor(i)} style={{...baseBtn,padding:"4px 8px",background:"transparent",color:C.danger,fontSize:13}} title="Remove contractor">✕</button></td>
          </tr>))}
        </tbody></table>
      </div>
      {contractors.length===0&&<div style={{textAlign:"center",padding:40,color:C.textMuted}}>No contractors yet. Click "+ Add Contractor" to get started.</div>}
    </div>);
  };

  // ═══ SETUP ═══
  const renderSetup=()=>(<div style={{display:"flex",flexDirection:"column",gap:24}}>
    {/* Teams Backup / Restore */}
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:24}}>
      <h3 style={{margin:"0 0 6px",color:C.accent,fontSize:14}}>💾 Data Backup (Microsoft Teams)</h3>
      <p style={{margin:"0 0 16px",fontSize:12,color:C.textMuted}}>Save a backup file to your Teams folder after each payroll run. Load it back to restore all history.</p>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
        <button onClick={exportBackup} style={{...baseBtn,padding:"10px 24px",background:C.accent,color:"#000",fontSize:13}}>⬇ Save Backup to File</button>
        <label style={{...baseBtn,padding:"10px 24px",background:C.infoDim,color:C.info,fontSize:13,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6}}>
          ⬆ Load Backup from File
          <input type="file" accept=".json" style={{display:"none"}} onChange={e=>{importBackup(e.target.files?.[0]);e.target.value="";}} />
        </label>
        {lastSaved&&<span style={{fontSize:11,color:C.textMuted}}>Auto-saved {lastSaved.toLocaleTimeString()}</span>}
      </div>
      <div style={{marginTop:16,paddingTop:16,borderTop:"1px solid "+C.border}}>
        <button
          onClick={()=>{if(window.confirm("Clear ALL payroll data? This cannot be undone.\n\nSave a backup first if you need to keep this data.")){localStorage.clear();window.location.reload();}}}
          style={{...baseBtn,padding:"8px 20px",background:"transparent",color:C.danger,border:"1px solid "+C.danger,fontSize:12}}>
          🗑 Clear All Data
        </button>
        <span style={{fontSize:11,color:C.textMuted,marginLeft:12}}>Resets everything — use before starting a fresh pay period</span>
      </div>
    </div>
    {/* Paychex Settings */}
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:10,padding:24}}>
      <h3 style={{margin:"0 0 16px",color:C.accent,fontSize:14}}>Paychex Configuration</h3>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <Input label="Week Ending" type="date" value={config.weekEnding} onChange={e=>setConfig(p=>({...p,weekEnding:e.target.value}))} />
        <Input label="Company ID" value={config.companyId} onChange={e=>setConfig(p=>({...p,companyId:e.target.value}))} />
        <Input label="Pay Component REG (case-sensitive)" value={config.payComponentREG} onChange={e=>setConfig(p=>({...p,payComponentREG:e.target.value}))} />
        <Input label="Pay Component OT (case-sensitive)" value={config.payComponentOT} onChange={e=>setConfig(p=>({...p,payComponentOT:e.target.value}))} />
        <Input label="Pay Component DT (case-sensitive)" value={config.payComponentDT||"Double Time"} onChange={e=>setConfig(p=>({...p,payComponentDT:e.target.value}))} />
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

  // ═══ HELP ═══
  const renderHelp=()=>{
    const S={card:{background:C.surface,border:"1px solid "+C.border,borderRadius:12,padding:24,marginBottom:0},
      h2:{margin:"0 0 4px",fontSize:16,fontWeight:700,color:C.accent},
      h3:{margin:"0 0 12px",fontSize:13,fontWeight:700,color:C.text,textTransform:"uppercase",letterSpacing:1},
      p:{margin:"0 0 10px",fontSize:13,color:C.textDim,lineHeight:1.6},
      label:{fontSize:11,fontWeight:700,color:C.accent,display:"block",marginBottom:2,textTransform:"uppercase",letterSpacing:0.5},
      field:{marginBottom:14,paddingBottom:14,borderBottom:"1px solid "+C.border},
      step:{display:"flex",gap:16,alignItems:"flex-start",marginBottom:20},
      stepNum:{width:36,height:36,borderRadius:"50%",background:C.accent,color:"#000",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:900,fontSize:15,flexShrink:0},
      faqQ:{fontSize:13,fontWeight:700,color:C.text,marginBottom:4},
      faqA:{fontSize:12,color:C.textDim,lineHeight:1.65,margin:"0 0 18px"},
      badge:{display:"inline-block",background:C.accentDim,color:C.accentBright,borderRadius:4,padding:"1px 7px",fontSize:10,fontWeight:700,marginLeft:6,verticalAlign:"middle"}};
    return(<div style={{display:"flex",flexDirection:"column",gap:24}}>

      {/* HEADER */}
      <div style={{background:"linear-gradient(135deg,#0f2027,#203a43,#2c5364)",borderRadius:12,padding:"28px 32px",border:"1px solid "+C.border}}>
        <div style={{fontSize:22,fontWeight:900,color:C.accent,marginBottom:6}}>ADG Payroll Dashboard — User Guide</div>
        <p style={{...S.p,margin:0,fontSize:14}}>Built by <strong style={{color:C.accent}}>ACT (Astro Consulting & Technology)</strong> for Astro Dynamic Group. This tool replaces the manual spreadsheet process — importing client payroll files, organizing data, and exporting a Paychex-ready CSV file with one click.</p>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>

        {/* QUICK START */}
        <div style={{...S.card,gridColumn:"1/-1"}}>
          <div style={{...S.h2,marginBottom:16}}>⚡ Quick Start — 5 Steps</div>
          <p style={{...S.p,marginBottom:20}}>Every pay period, follow these steps in order:</p>
          {[
            ["1","⚙️","Setup Tab — Set the pay period","Go to Setup. Set the Week Ending date (the last day of the pay week, usually a Friday). Confirm the Company ID matches your Paychex account. You only need to do this once per week."],
            ["2","📥","Import Tab — Upload your client files","Drag and drop ALL your client files into the Smart Upload zone at once — PDFs, Excel, and CSV files. The system auto-detects King Aerospace, Bombardier, and Red Oak. For new clients, it will ask you to map columns once; after that, it remembers. You can also click individual client cards below the dropzone."],
            ["3","🔗","Names Tab — Match any new names","If the system doesn't recognize a name from a file (e.g. a new hire), the Names tab will show a badge with the count. Go there and match each imported name to the correct contractor from your roster."],
            ["4","✏️","Review Tab — Verify and correct","Check every row. Fill in any missing Worker IDs (required by Paychex). For Bombardier entries, enter the actual REG and OT hours — those aren't in their PDF. Fix any red errors before exporting."],
            ["5","✅","Export Tab — Download the Paychex file","Once the status dot in the top-right turns green, click 'Export Paychex SPI CSV'. Upload that file directly to Paychex to process payroll. Done!"]
          ].map(([n,icon,title,desc])=>(
            <div key={n} style={S.step}>
              <div style={S.stepNum}>{n}</div>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:C.text,marginBottom:3}}>{icon} {title}</div>
                <div style={{fontSize:12,color:C.textDim,lineHeight:1.65}}>{desc}</div>
              </div>
            </div>
          ))}
          <div style={{background:C.warnDim,borderRadius:8,padding:"12px 16px",border:"1px solid "+C.warn}}>
            <span style={{color:C.warn,fontWeight:700,fontSize:12}}>💾 After every run:</span>
            <span style={{fontSize:12,color:C.textDim,marginLeft:8}}>Go to Setup → click "Save Backup to File" → save it to your Microsoft Teams payroll folder. This keeps a permanent record for taxes.</span>
          </div>
        </div>

        {/* TAB REFERENCE */}
        <div style={S.card}>
          <div style={{...S.h2,marginBottom:16}}>🗂 Tab-by-Tab Reference</div>

          <div style={{marginBottom:20}}>
            <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:8}}>📊 Dashboard</div>
            {[["Week Ending","The current pay period date. Set it in Setup."],
              ["Export Status","NOT READY = data is missing or has errors. READY = safe to export."],
              ["Margin","How much profit ADG makes this week (Billing minus Payroll)."],
              ["Weekly Payroll","Total amount ADG pays all workers this week."],
              ["Weekly Billing","Total amount ADG charges all clients this week."],
              ["YTD rows","Year-to-date totals — all pay periods combined since the last clear."],
              ["Status dot (top right)","Green = ready to export. Red = errors exist."]].map(([f,d])=>(
              <div key={f} style={S.field}><span style={S.label}>{f}</span><span style={{...S.p,margin:0}}>{d}</span></div>))}
          </div>

          <div style={{marginBottom:20}}>
            <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:8}}>📥 Import</div>
            {[["Smart Upload Dropzone","Drag and drop multiple files at once (PDF, Excel, CSV). The system auto-detects which client each file belongs to and queues them all for import."],
              ["Upload Queue","Shows every file you dropped in with its status: ✅ Ready (auto-detected), 🔧 Needs Mapping (unknown client), or ❌ Error. Use 'Import All Ready' to confirm everything at once."],
              ["Column Mapper","When the system doesn't recognize a file, it shows a mapper UI. Pick which columns are Employee Name, REG Hours, OT Hours, and Per Diem. Enter a client name and click Apply. Check 'Remember for next time' so you never have to do it again."],
              ["Client Cards","The 3 built-in clients (King Aerospace, Bombardier, Red Oak) plus any custom clients you've configured. Click a card to upload a file pre-tagged to that client. New cards appear automatically when you save a mapping."],
              ["Saved Client Profiles","Shows all your saved column mappings. The system uses these to auto-process files next week. You can delete a profile if it's no longer needed."],
              ["Quick Add (Manual)","Need to add an entry that wasn't in any file? Pick a contractor from the dropdown and type their hours here."],
              ["Import Notes","Yellow notes appear if the system had trouble reading part of a file. Non-critical — review them but don't panic."]].map(([f,d])=>(
              <div key={f} style={S.field}><span style={S.label}>{f}</span><span style={{...S.p,margin:0}}>{d}</span></div>))}
          </div>

          <div style={{marginBottom:20}}>
            <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:8}}>🔗 Names</div>
            {[["Name Matching","When a name from a PDF/Excel doesn't exactly match your Contractor Roster, it shows up here. Use the dropdown to tell the system who it is."],
              ["Badge count","The red number on the Names tab = how many names still need matching. Get it to 0 before reviewing."]].map(([f,d])=>(
              <div key={f} style={S.field}><span style={S.label}>{f}</span><span style={{...S.p,margin:0}}>{d}</span></div>))}
          </div>

          <div>
            <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:8}}>📋 Audit</div>
            <div style={S.field}><span style={S.label}>Audit Log</span><span style={{...S.p,margin:0}}>Every action — imports, edits, exports, deletes — is logged here with a timestamp. Useful for accountability and troubleshooting.</span></div>
          </div>
        </div>

        {/* FIELD REFERENCE RIGHT COLUMN */}
        <div style={S.card}>
          <div style={{...S.h2,marginBottom:16}}>🗂 Tab-by-Tab Reference (continued)</div>

          <div style={{marginBottom:20}}>
            <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:8}}>✏️ Review</div>
            {[["Status icon (✓/⚠/⛔)","Green check = this row is clean. Yellow = warning, okay to export but double-check. Red = must fix before Paychex will accept the file."],
              ["Worker ID","The employee's ID number inside Paychex. Required. If blank, Paychex rejects the entire file. Find it in your Paychex account under Employees."],
              ["Client","Which client this work was billed to (King Aerospace, Bombardier Hartford, or Red Oak)."],
              ["Job Title","The worker's role — used to look up the correct bill rates from the Rate Card."],
              ["REG Hrs","Regular hours worked (up to 40 hrs/week). Edit directly in this cell."],
              ["OT Hrs","Overtime hours (over 40 hrs/week). Edit directly in this cell."],
              ["Per Diem","Non-taxable daily meal/travel allowance paid to this worker. Enter as a dollar amount."],
              ["Pay Total","Auto-calculated: (REG hrs × Pay REG rate) + (OT hrs × Pay OT rate) + Per Diem."],
              ["Bill Total","Auto-calculated: (REG hrs × Bill REG rate) + (OT hrs × Bill OT rate) + Per Diem."],
              ["✕ button","Removes this entry from the current pay period. Does not affect other weeks."],
              ["TOTALS row","Sum of all columns across all workers. Auto-updates as you edit."]].map(([f,d])=>(
              <div key={f} style={S.field}><span style={S.label}>{f}</span><span style={{...S.p,margin:0}}>{d}</span></div>))}
          </div>

          <div style={{marginBottom:20}}>
            <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:8}}>👷 Contractors</div>
            {[["Name","Format: Last, First. Must be consistent — spelling must match what comes from the client files, or use the Names tab to bridge the gap."],
              ["Worker ID","Paychex employee ID. Required for export. Enter it here once and it will pre-fill every week."],
              ["Client","Which client(s) this contractor works for. Informational only."],
              ["Dept","Department or job site. Informational only."],
              ["Job Title","Selecting a job title auto-fills the Bill REG and Bill OT rates from the Rate Card."],
              ["Pay REG","The hourly wage ADG pays this worker for regular hours."],
              ["Pay OT","The hourly wage ADG pays this worker for overtime hours (typically 1.5× Pay REG)."],
              ["Bill REG","The hourly rate ADG charges the client for this worker's regular hours."],
              ["Bill OT","The hourly rate ADG charges the client for overtime hours."],
              ["Per Diem","Default daily per diem amount for this worker. Can be overridden per week in the Review tab."],
              ["Active (Y/N)","Y = worker shows in Import dropdowns and gets processed. N = worker is hidden but their history stays."]].map(([f,d])=>(
              <div key={f} style={S.field}><span style={S.label}>{f}</span><span style={{...S.p,margin:0}}>{d}</span></div>))}
          </div>

          <div>
            <div style={{fontWeight:700,color:C.accent,fontSize:13,marginBottom:8}}>✅ Export</div>
            {[["Export Paychex SPI CSV","Downloads a .csv file formatted to Paychex's SPI import spec. Upload this file to Paychex to process the week's payroll. Only enabled when there are no red errors."],
              ["Export QB Invoice CSV","Downloads a QuickBooks-compatible invoice file showing what ADG billed each client. Optional — for internal bookkeeping."]].map(([f,d])=>(
              <div key={f} style={S.field}><span style={S.label}>{f}</span><span style={{...S.p,margin:0}}>{d}</span></div>))}
          </div>
        </div>
      </div>

      {/* SETUP REFERENCE */}
      <div style={S.card}>
        <div style={{...S.h2,marginBottom:16}}>⚙️ Setup — Field Reference</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 32px"}}>
          {[["Week Ending","The last day of the current pay week (usually a Friday). All imported entries are tagged to this date. Change this at the start of every new pay period."],
            ["Company ID","Your Paychex company number. Pre-filled as 70157401. Only change if Paychex tells you otherwise."],
            ["Pay Component REG","The exact name Paychex uses for regular pay in your account. Case-sensitive. Default: Hourly."],
            ["Pay Component OT","The exact name Paychex uses for overtime pay. Default: Overtime reg amt."],
            ["Pay Component DT","The name Paychex uses for double-time (King Aerospace only). Default: Double Time."],
            ["Pay Component Per Diem","The name Paychex uses for non-taxable per diem. Default: Per Diem Non Tax."],
            ["Target Margin %","The profit margin ADG aims for. Used to color the Margin indicator on the Dashboard: green if above target, yellow if below."],
            ["OT Threshold (hours)","After this many REG hours in a week, the system flags OT warnings. Default is 40."],
            ["Rate Card","Standard bill rates for each job title. Selecting a job title on a contractor auto-fills their bill rates from here."],
            ["Save Backup to File","Downloads all your data (contractors, entries, history) as a .json file. Save this to your Microsoft Teams payroll folder for tax-record keeping."],
            ["Load Backup from File","Restores all data from a previously saved .json backup. Use when switching computers or recovering from an accident."],
            ["Clear All Data","Wipes the app completely. Always save a backup first. Good for starting a fresh year or fixing a corrupted session."]].map(([f,d])=>(
            <div key={f} style={S.field}><span style={S.label}>{f}</span><span style={{...S.p,margin:0}}>{d}</span></div>))}
        </div>
      </div>

      {/* FAQ */}
      <div style={S.card}>
        <div style={{...S.h2,marginBottom:20}}>❓ Frequently Asked Questions</div>
        {[
          ["What does this tool actually do?","It replaces the manual process of copying numbers from 3 different client payroll files into a spreadsheet. You upload the files, the system reads them, and you download one clean CSV that goes straight into Paychex. Less typing = less human error."],
          ["Why do I need to enter hours for Bombardier employees manually?","Bombardier's PDF is an invoice — it shows how many days each employee worked and the total bill, but not the individual daily hours. ADG knows the hours separately. So the system imports everything it can from the PDF and flags those rows for you to fill in the REG/OT split."],
          ["What is a Worker ID and where do I find it?","The Worker ID is Paychex's internal ID number for each employee. Log in to Paychex, go to Employees, and find each person. Their ID is listed on their profile page. You only need to enter it once — the system saves it forever."],
          ["What happens if I close the browser?","Your data is safe. Everything auto-saves to your browser's local storage every time you make a change. When you come back and open the same URL, it picks right up where you left off. The auto-save timestamp in Setup confirms when it last saved."],
          ["What is the difference between Pay Rate and Bill Rate?","Pay Rate is what ADG pays the worker. Bill Rate is what ADG charges the client. The difference is ADG's profit (margin). Example: ADG pays a tech $25/hr (Pay REG) but bills King Aerospace $35/hr (Bill REG) — ADG keeps the $10 difference."],
          ["What is Per Diem?","A non-taxable daily allowance to cover meals and travel costs. It's paid to the worker on top of their wages but isn't subject to income tax. The amount varies by worker — enter the default in the Contractors tab, and adjust per-week in Review if needed."],
          ["What does 'DT' mean on King Aerospace?","Double Time. California labor law requires workers to be paid 2× their regular rate after 12 hours in a single day or on the 7th consecutive day of work. King Aerospace tracks this separately and it shows up in their timecard report."],
          ["Why is the Export button grayed out?","There's at least one red ⛔ error in the Review tab. Common causes: (1) a Worker ID is missing, or (2) a name wasn't matched in the Names tab. Fix all red errors and the button will activate."],
          ["What's the difference between a Warning and an Error?","Errors (⛔ red) block the export — Paychex will reject the file if they're not fixed. Warnings (⚠ yellow) are flags for your review but don't block export. Example: a warning appears if REG hours exceed 40 (possible OT issue), but you can still export after you've reviewed it."],
          ["How do I handle a new contractor who isn't in the roster yet?","Go to Contractors tab → click '+ Add Contractor' → enter their name in Last, First format. Fill in their Pay and Bill rates. Add their Worker ID from Paychex. They'll appear in the Import dropdown immediately."],
          ["Can I use this on multiple computers?","Yes. After each payroll run, save a backup file (Setup → Save Backup to File) and store it in Teams. On the other computer, open the app → Setup → Load Backup from File. All your contractors, rates, and history will be restored."],
          ["What if a client sends me a file in a new format?","No problem — you can handle it yourself! Drop the file into the Smart Upload zone. If the system doesn't recognize it, a Column Mapper will appear. Just tell it which column is the Employee Name and which is REG Hours, enter the client name, and check 'Remember for next time'. A new client card will appear on the Import tab, and the system will auto-process that client's files every week going forward."],
          ["Is my data secure?","Yes. All data stays on your computer in the browser. No payroll data is ever sent to any server or third party. The PDF parsing happens directly in your browser — the file never leaves your machine."]
        ].map(([q,a])=>(
          <div key={q} style={{marginBottom:16,paddingBottom:16,borderBottom:"1px solid "+C.border}}>
            <div style={S.faqQ}>Q: {q}</div>
            <div style={S.faqA}>A: {a}</div>
          </div>
        ))}
      </div>

      {/* FOOTER */}
      <div style={{textAlign:"center",padding:"16px 0",fontSize:11,color:C.textMuted}}>
        ADG Payroll Dashboard · Built by ACT (Astro Consulting & Technology) · Questions? Contact ACT.
      </div>
    </div>);
  };

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
      <TabBtn id="help" label="Help" icon={"❓"} />
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
      {tab==="help"&&renderHelp()}
    </div>
  </div>);
}
