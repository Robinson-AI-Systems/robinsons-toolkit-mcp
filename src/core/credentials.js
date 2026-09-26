const secretFields=new Set(['password','secret','apikey','accesstoken','refreshtoken','authtoken','privatekey','clientsecret','connectionstring','databaseurl','authorization','token']);
const secretField=name=>secretFields.has(name.toLowerCase().replace(/[^a-z0-9]/g,''))||/secret[_-]?key$/i.test(name);
/** Environment resolver plus in-memory redaction of configured and newly handled secrets. */
export class EnvironmentCredentials {
  #env; #observed=new Set();
  constructor(env=process.env){this.#env=env;}
  has(name){return typeof this.#env[name]==='string'&&this.#env[name].trim().length>0;}
  configuration(name){return this.#env[name];}
  rememberSecrets(value){
    const seen=new WeakSet();
    const visit=(item,sensitive=false)=>{
      if(typeof item==='string'){if(sensitive&&item.length>=4)this.#observed.add(item);return;}
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
    const values=new Set(this.#observed);
    for(const [name,secret]of Object.entries(this.#env))if(/KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING|DATABASE_URL/i.test(name)&&typeof secret==='string'&&secret.length>=4)values.add(secret);
    const variants=[...new Set([...values].flatMap(secret=>[secret,encodeURIComponent(secret)]))].sort((a,b)=>b.length-a.length);
    const visit=item=>{
      if(Array.isArray(item))return item.map(visit);
      if(item&&typeof item==='object'){
        const namedSecret=typeof item.key==='string'&&/KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING|DATABASE_URL/i.test(item.key);
        return Object.fromEntries(Object.entries(item).map(([key,child])=>[key,secretField(key)||(namedSecret&&key==='value')?'[REDACTED]':visit(child)]));
      }
      if(typeof item!=='string')return item;
      let text=item;for(const secret of variants)text=text.split(secret).join('[REDACTED]');return text;
    };
    return visit(value);
  }
}
