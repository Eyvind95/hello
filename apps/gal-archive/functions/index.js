"use strict";
const crypto = require("node:crypto");
const {onRequest} = require("firebase-functions/v2/https");
const {initializeApp, getApps} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
if (!getApps().length) initializeApp();
const db = getFirestore();
const send = (res, status, body) => res.status(status).json(body);
const hash = value => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const valid = (s, min, max) => typeof s === "string" && s.length >= min && s.length <= max;
const safeEq = (a,b) => {
  if (!/^[a-f0-9]{64}$/.test(a||"") || !/^[a-f0-9]{64}$/.test(b||"")) return false;
  return crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
};
// The endpoint does NOT accept a Firebase admin key from ChatGPT.
// The owner creates a scoped random token in the authenticated website.
// This API only creates pending inbox items, never edits canonical history.
exports.archiveIngest = onRequest(
  {region:"asia-east1",cors:false,invoker:"public",maxInstances:3,memory:"256MiB",timeoutSeconds:30},
  async (req,res) => {
    res.set("Cache-Control","no-store");
    if (req.method !== "POST") {res.set("Allow","POST");return send(res,405,{error:"method_not_allowed"});}
    if (!req.is("application/json")) return send(res,415,{error:"content_type_must_be_json"});
    const rawToken = (req.get("Authorization")||"").match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
    if (!rawToken) return send(res,401,{error:"missing_or_invalid_bearer_token"});
    const body=req.body;
    if (!body || typeof body!=="object" || Array.isArray(body))return send(res,400,{error:"invalid_json_body"});
    const {uid,cycleId,sourceId,manager,entries,chatKey,messageOrder,sourceCreatedAt,sourceTimeOrigin,sourceTimePrecision,capturedAt}=body;
    if(!valid(uid,5,128)||!/^[A-Za-z0-9_-]+$/.test(uid)||
       !valid(cycleId,5,160)||!/^[A-Za-z0-9_-]+$/.test(cycleId)||
       !valid(sourceId,5,180)||!Array.isArray(entries)||entries.length<1||entries.length>10||
       !valid(manager,1,100)||
       (chatKey!==undefined&&(!valid(chatKey,12,64)||!/^[a-f0-9]{12,64}$/i.test(chatKey)))||
       (messageOrder!==undefined&&(!Number.isInteger(messageOrder)||messageOrder<0||messageOrder>1000000)))return send(res,400,{error:"invalid_metadata"});
    const optionalTime=t=>t===null||t===undefined||(typeof t==='string'&&t.length<=40&&/^\d{4}-\d{2}-\d{2}T/.test(t)&&Number.isFinite(Date.parse(t)));
    if(!optionalTime(sourceCreatedAt)||!optionalTime(capturedAt))return send(res,400,{error:'invalid_timestamp'});
    if(sourceTimeOrigin!=null&&!['dom','menu','reply-inferred','manual'].includes(sourceTimeOrigin))return send(res,400,{error:'invalid_time_origin'});
    if(sourceTimePrecision!=null&&!['source','minute','minute-estimated'].includes(sourceTimePrecision))return send(res,400,{error:'invalid_time_precision'});
    let total=0;
    const payload=[];
    for(const [i,e] of entries.entries()){
      if(!e||typeof e!=="object"||!["chat","quiz","changes"].includes(e.section)||
         !["me","ai"].includes(e.role)||!valid(e.text,1,25000))return send(res,400,{error:"invalid_entry",index:i});
      total+=e.text.length;
      payload.push({section:e.section,role:e.role,text:e.text});
    }
    if(total>40000)return send(res,413,{error:"entries_too_large"});
    try{
      const root=db.collection("galArchive").doc(uid);
      const setting=await root.collection("integration").doc("autoWriter").get();
      if(!setting.exists||setting.get("enabled")!==true||
        !safeEq(setting.get("tokenHash"),hash(rawToken)))return send(res,403,{error:"token_not_authorized"});
      const cycle=await root.collection("cycles").doc(cycleId).get();
      if(!cycle.exists)return send(res,404,{error:"cycle_not_found_upload_cycle_first"});
      // Supports V4.3 managerNames[] and older comma/ideographic-comma separated manager text.
      // Each event is attributed to precisely one allowed manager, not the combined roster.
      const parseManagers = values => {
        const list = Array.isArray(values) ? values : [values || ""];
        return [...new Set(list.flatMap(v => String(v || "").split(/[、，,;；\r\n]+/))
          .map(v => v.trim()).filter(Boolean))];
      };
      const configured = cycle.get("managerNames");
      const assigned = parseManagers(Array.isArray(configured) && configured.length
        ? configured : cycle.get("manager"));
      if (assigned.length && !assigned.includes(manager.trim())) {
        return send(res,403,{error:"manager_does_not_match_cycle",allowedManagers:assigned});
      }
      const result=[];
      for(let i=0;i<payload.length;i++){
        const e=payload[i],eventId=hash(uid+"|"+cycleId+"|"+sourceId+"|"+i);
        // V2 per-cycle inbox. An incoming item belongs to exactly one cycle.
        // Old flat inbox is read only for idempotency, never written again.
        const ref=root.collection("cycles").doc(cycleId).collection("incoming").doc(eventId);
        const oldRef=root.collection("incoming").doc(eventId);
        try{
          if((await oldRef.get()).exists||(await ref.get()).exists){
            result.push({index:i,status:"duplicate",id:eventId});
            continue;
          }
          await ref.create({
            cycleId,manager:manager.trim(),sourceId,section:e.section,
            role:e.role,text:e.text,status:"pending",
            ...(chatKey?{chatKey}:{}),...(Number.isInteger(messageOrder)?{messageOrder}:{}),
            ...(sourceCreatedAt?{sourceCreatedAt}:{}),...(sourceCreatedAt&&sourceTimeOrigin?{sourceTimeOrigin}:{}),...(sourceCreatedAt&&sourceTimePrecision?{sourceTimePrecision}:{}),...(capturedAt?{capturedAt}:{}),
            receivedAt:FieldValue.serverTimestamp(),schemaVersion:2,storageLayout:"cycle-scoped"
          });
          result.push({index:i,status:"created",id:eventId});
        }catch(err){
          if(err.code===6||err.code==="already-exists")result.push({index:i,status:"duplicate",id:eventId});
          else throw err;
        }
      }
      return send(res,200,{ok:true,cycleId,results:result});
    }catch(err){
      console.error("archiveIngest",err);
      return send(res,500,{error:"server_error"});
    }
  }
);
