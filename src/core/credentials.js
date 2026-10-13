const secretFields=new Set(['password','secret','apikey','accesstoken','refreshtoken','authtoken','privatekey','clientsecret','connectionstring','databaseurl','authorization','token']);
const secretField=name=>secretFields.has(name.toLowerCase().replace(/[^a-z0-9]/g,''))||/secret[_-]?key$/i.test(name);
/** Environment resolver plus in-memory redaction of configured and newly handled secrets. */
export class EnvironmentCredentials {
  #env; #observed=new Set();
  constructor(env=process.env){this.#env=env;}
  #remember(value){
    if(value.length<4)return;
    this.#observed.add(value);
    try{const password=decodeURIComponent(new URL(value).password);if(password.length>=4)this.#observed.add(password);}catch{}
  }
  has(name){return typeof this.#env[name]==='string'&&this.#env[name].trim().length>0;}
  configuration(name){return this.#env[name];}
  rememberSecrets(value){
    const seen=new WeakSet();
    const visit=(item,sensitive=false)=>{
      if(typeof item==='string'){if(sensitive)this.#remember(item);return;}
      if(!item||typeof item!=='object'||seen.has(item))return;
      seen.add(item);
      if(Array.isArray(item)){item.forEach(v=>visit(v,sensitive));return;}
      const namedSecret=typeof item.key==='string'&&/KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING|DATABASE_URL/i.test(item.key);
      for(const [key,child]of Object.entries(item))visit(child,sensitive||secretField(key)||(namedSecret&&key==='value'));
    };
    visit(value);
  }
  redact(value){
    this.rememberSecrets(value);
    for(const [name,secret]of Object.entries(this.#env))if(/KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING|DATABASE_URL/i.test(name)&&typeof secret==='string')this.#remember(secret);
    const values=new Set(this.#observed);
    const variants=[...new Set([...values].flatMap(secret=>[secret,encodeURIComponent(secret)]))].sort((a,b)=>b.length-a.length);
    const visit=item=>{
      if(Array.isArray(item))return item.map(visit);
      if(item&&typeof item==='object'){
        const namedSecret=typeof item.key==='string'&&/KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING|DATABASE_URL/i.test(item.key);
        return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,secretField(key)||(namedSecret&&key==='value')?'[REDACTED]':visit(child)]));
      }
      if(typeof item!=='string')return item;
      let text=item;for(const secret of variants)text=text.split(secret).join('[REDACTED]');
      // Remote URLs and authorization errors can contain credentials that were
      // loaded by a child from repository configuration rather than our resolver.
      return text.replace(/\b((?:https?|postgres(?:ql)?|rediss?|amqps?):\/\/)[^/\s@]+@/gi,'$1[REDACTED]@')
        .replace(/([?&](?:access_token|api_key|token|password|secret)=)[^&#\s"'<>]+/gi,'$1[REDACTED]')
        .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi,'Bearer [REDACTED]');
    };
    return visit(value);
  }
}
