import { describe,expect,it } from 'vitest';
import { startWorker } from './main';
describe('worker',()=>it('exports a worker factory',()=>expect(typeof startWorker).toBe('function')));
