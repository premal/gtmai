import { describe,expect,it } from 'vitest';
import { buildApp } from './main';
describe('api',()=>it('health checks',async()=>{const app=await buildApp();const response=await app.inject({method:'GET',url:'/health'});expect(response.statusCode).toBe(200);await app.close()}));
