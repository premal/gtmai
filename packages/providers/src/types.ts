import { z } from 'zod';
export type ActionResult<O> = {found:true;data:O;raw?:unknown}|{found:false;reason?:string};
export type RunContext = {credentials:Record<string,string>;fetch:typeof fetch;logger:{info(message:string):void;error(message:string):void}};
export type ProviderAction<I = unknown,O = unknown> = {id:string;name:string;category:'work_email'|'personal_email'|'phone'|'person'|'company'|'verify'|'search'|'ai'|'other';input:z.ZodTypeAny;output:z.ZodTypeAny;creditCost:number;run(input:I,ctx:RunContext):Promise<ActionResult<O>>};
export type Provider = {id:string;name:string;auth:{type:'apiKey';fields:{key:string;label:string;secret:true}[]};actions:ProviderAction<unknown,unknown>[]};
