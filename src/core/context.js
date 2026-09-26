import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const currentWorkspace=()=>context.getStore()?.workspace||process.env.WORKSPACE_ROOT||process.cwd();
export const withExecutionContext=(value,operation)=>context.run(value,operation);
export const currentWriteRoots=()=>context.getStore()?.writeRoots;
export const currentExecutionContext=()=>context.getStore()||{};
export const currentDispatcher=()=>context.getStore()?.dispatch;
