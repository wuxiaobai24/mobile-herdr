import { expect, test } from 'bun:test';
import { lstat, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { materializeNativeAssets, nativeRuntimeAssets } from '../server/native/assets';
test('SSH takeover ships complete bundled helpers, reuses a verified private cache, and preserves older runtimes', async () => {
  const directory=await mkdtemp(join(tmpdir(),'mh-assets-'));
  try {
    const assets=await nativeRuntimeAssets(resolve(import.meta.dir,'..'));
    const root=await materializeNativeAssets(directory,assets);
    expect(Object.keys(assets).length).toBe(5);
    expect(await materializeNativeAssets(directory,assets)).toBe(root);
    expect((await lstat(root)).mode&0o077).toBe(0);
    const next=await materializeNativeAssets(directory,{...assets,'scripts/agent.ts':assets['scripts/agent.ts']+'\n// next release\n'});
    expect(next).not.toBe(root);expect(await readFile(join(root,'scripts/agent.ts'),'utf8')).toBe(assets['scripts/agent.ts']);
    await rm(join(root,'scripts/agent.ts'));await symlink(join(next,'scripts/agent.ts'),join(root,'scripts/agent.ts'));
    await expect(materializeNativeAssets(directory,assets)).rejects.toThrow('校验失败');
    await expect(materializeNativeAssets(directory,{...assets,'../outside':'unsafe'})).rejects.toThrow('无效');
  } finally {await rm(directory,{recursive:true,force:true});}
});
