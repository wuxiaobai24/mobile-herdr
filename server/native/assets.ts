import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
const FILES = ['scripts/agent.ts', 'scripts/native-host.ts', 'scripts/takeover-launch.ts', 'scripts/codex-proxy.ts', 'plugins/pi/mobile-herdr.ts'] as const;
export type NativeAssets = Record<string, string>;
let cached: Promise<NativeAssets> | undefined;
/** The SSH worker gets the same reviewed runtime, not commands the user must install. */
export function nativeRuntimeAssets(root: string): Promise<NativeAssets> {
  cached ??= (async () => {
    const packaged = !!await lstat(join(root, 'release.json')).catch(() => undefined);
    return Object.fromEntries(await Promise.all(FILES.map(async path => {
      if (packaged) return [path, await readFile(join(root, path), 'utf8')];
      const built = await Bun.build({entrypoints:[join(root,path)],target:path.startsWith('plugins/')?'node':'bun',packages:'bundle'});
      if (!built.success) throw new Error('无法准备远端接管组件。');
      return [path, await built.outputs[0].text()];
    })));
  })().catch(error => {cached=undefined;throw error;});
  return cached;
}
export async function materializeNativeAssets(stateDir: string, assets: NativeAssets): Promise<string> {
  if (!assets || Object.keys(assets).length !== FILES.length || FILES.some(path => typeof assets[path] !== 'string') || Object.values(assets).reduce((sum,text)=>sum+Buffer.byteLength(text),0)>8*1024*1024) throw new Error('无效接管组件。');
  const fingerprint = createHash('sha256').update(JSON.stringify(FILES.map(path=>[path,assets[path]]))).digest('hex');
  const cache = join(stateDir, 'runtime'); await mkdir(cache,{recursive:true,mode:0o700});
  const cacheInfo=await lstat(cache);if(!cacheInfo.isDirectory()||cacheInfo.uid!==process.getuid?.()||cacheInfo.mode&0o077)throw new Error('接管缓存目录不安全。');
  const root = join(cache,fingerprint);
  async function verify(): Promise<void> {
    const directory=await lstat(root); if(!directory.isDirectory()||directory.uid!==process.getuid?.()||directory.mode&0o077) throw new Error('接管目录不安全。');
    for(const path of FILES){const file=join(root,path),info=await lstat(file);if(!info.isFile()||info.uid!==process.getuid?.()||info.mode&0o077||await readFile(file,'utf8')!==assets[path])throw new Error('接管组件校验失败。');}
  }
  if(await lstat(root).catch(()=>undefined)){await verify();return root;}
  const stage=await mkdtemp(join(cache,'.stage-'));await chmod(stage,0o700);
  try {
    for(const path of FILES){await mkdir(dirname(join(stage,path)),{recursive:true,mode:0o700});await writeFile(join(stage,path),assets[path],{mode:0o600});}
    try{await rename(stage,root);}catch(error){if(!['EEXIST','ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
    await verify();return root;
  } finally {await rm(stage,{recursive:true,force:true});}
}
