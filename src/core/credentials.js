/** Environment resolver. Does not serialize or log credential values. */
export class EnvironmentCredentials {
  #env;
  constructor(env=process.env){this.#env=env;}
  has(name){return typeof this.#env[name]==='string'&&this.#env[name].trim().length>0;}
  configuration(name){return this.#env[name];}
  redact(value){
    if(Array.isArray(value))return value.map(item=>this.redact(item));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,this.redact(item)]));
    if(typeof value!=='string')return value;
    let text=value;
    for(const [name,secret] of Object.entries(this.#env)){
      if(/KEY|TOKEN|SECRET|PASSWORD|CONNECTION_STRING|DATABASE_URL/i.test(name)&&typeof secret==='string'&&secret.length>=4){
        for(const variant of new Set([secret,encodeURIComponent(secret)]))text=text.split(variant).join('[REDACTED]');
      }
    }
    return text;
  }
}
