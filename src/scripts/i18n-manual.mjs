import * as fs from 'fs';

function patch(f, pairs) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [bad, good] of pairs) {
    if (!s.includes(bad)) { console.error('MISS ' + f + ' :: ' + bad.slice(0, 70)); process.exit(1); }
    s = s.split(bad).join(good);
  }
  fs.writeFileSync(f, s);
  console.log('ok', f);
}

const BT = '`';
const D = '${';

const errUnknownLogs = `{status === 'error' && ${BT}错误: ${D}error || '未知'}${BT}}`;
patch('src/components/Compose/ComposeLogsPage.tsx', [
  [errUnknownLogs, `{status === 'error' && t('错误: {p0}', { p0: error || t('未知') })}`],
]);

patch('src/components/Containers/LogViewerPage.tsx', [
  [errUnknownLogs, `{status === 'error' && t('错误: {p0}', { p0: error || t('未知') })}`],
]);

patch('src/components/Containers/TerminalPage.tsx', [
  [errUnknownLogs, `{status === 'error' && t('错误: {p0}', { p0: error || t('未知') })}`],
  [
    `{status === 'error' ? ${BT}连接失败：${D}error || '未知错误'}${BT} : t('会话已断开')}`,
    `{status === 'error' ? t('连接失败：{p0}', { p0: error || t('未知错误') }) : t('会话已断开')}`,
  ],
]);

patch('src/components/Containers/ContainerFilesDialog.tsx', [
  [
    `toast(${BT}已上传到 ${D}dir}/${D}res.path?.replace(/^.*\\//, '')}${BT}, 'success')`,
    'toast(t(' + "'已上传到 {p0}'" + `, { p0: ${BT}${D}dir}/${D}res.path?.replace(/^.*\\//, '')}${BT} }), 'success')`,
  ],
]);
