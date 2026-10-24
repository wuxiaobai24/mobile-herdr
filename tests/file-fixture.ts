import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { createFixture } from './fixture';

export async function prepareProjectFiles(fixture: Awaited<ReturnType<typeof createFixture>>): Promise<string> {
  const root = join(fixture.directory, 'files-project');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'empty'));
  await writeFile(join(root, '说明 文档.md'), '# 手机文件\n\n内容预览 ✓');
  await writeFile(join(root, 'src/hello.ts'), 'export const greeting = "你好";');
  await writeFile(join(root, 'archive.bin'), new Uint8Array([0, 1, 2, 255]));
  await writeFile(join(root, 'preview.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOQq3gGRww4OQBSLhHR6WGRvAAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(join(root, 'large.txt'), '可预览的长文件内容。\n'.repeat(18000));
  await symlink(fixture.transcript, join(root, 'external-link'));
  fixture.snapshot.panes[0].foreground_cwd = root;
  return root;
}
