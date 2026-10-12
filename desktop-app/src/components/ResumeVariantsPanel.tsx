import { useState } from 'react';
import { Button, Card, Input, Modal, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { useShallow } from 'zustand/react/shallow';
import { useDataStore } from '@/store/useDataStore';
import { resolveResumeForJob, type ResumeVariant } from '@/lib/bossclaw/resumeVariants';
import { tailorForJob } from '@/lib/bossclaw/jobAssistant';
import { buildResumeDocData } from '@/lib/bossclaw/resumeContact';
import { buildResumeHtml, FOCUS_MODULE_ORDER } from '@/lib/bossclaw/resumePdf';
import type { AppConfig } from '@/lib/bossclaw/types';

export default function ResumeVariantsPanel({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const data = useDataStore(useShallow(s => ({ resumeText: s.resumeText, profile: s.profile, resumeWritingPreferences: s.resumeWritingPreferences,
    resumeVariants: s.resumeVariants, defaultResumeVariantId: s.defaultResumeVariantId, autoResumeRouting: s.autoResumeRouting })));
  const [editing, setEditing] = useState<ResumeVariant | null>(null);
  const [exporting, setExporting] = useState('');
  const exportPdf = async (variant: ResumeVariant) => {
    setExporting(variant.id);
    try {
      const { source } = resolveResumeForJob(data, {}, variant.id);
      const result = await tailorForJob({}, source.text, source.profile, {} as AppConfig['model'], undefined, undefined, { resumeSource: source });
      const doc = buildResumeDocData(source.text, source.profile, result, undefined, [...FOCUS_MODULE_ORDER]);
      const html = buildResumeHtml(doc, 'personal');
      const name = `${doc.contact.name || '简历'}-${variant.name.replace(/[\\/:*?"<>|]/g, '')}.pdf`;
      if (window.electron?.savePdf) {
        const saved = await window.electron.savePdf(name, html);
        if (!saved.canceled && !saved.ok) throw new Error(saved.error || '保存失败');
        if (saved.ok) message.success('已导出该版本基础简历');
      } else {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = name.replace(/\.pdf$/, '.html'); a.click(); URL.revokeObjectURL(url);
        message.info('已下载排版文件，用浏览器打开后可打印为 PDF');
      }
    } catch (e) { message.error(String((e as Error).message || e)); }
    finally { setExporting(''); }
  };
  return <Card size="small" title="基础简历版本" style={{ marginBottom: 16 }} extra={<Button onClick={() => setEditing({ id: `resume_${Date.now().toString(36)}`, name: '新版本', kind: 'general', text: data.resumeText, fileName: '', updatedAt: Date.now() })}>新增版本</Button>}>
    <Space wrap style={{ marginBottom: 12 }}>
      <Switch aria-label="按岗位自动选简历" checked={data.autoResumeRouting} onChange={autoResumeRouting => useDataStore.getState().setResumeRouting({ autoResumeRouting })} />
      <Typography.Text>按岗位自动选版</Typography.Text>
      <Typography.Text type="secondary">默认版本</Typography.Text>
      <Select aria-label="默认简历版本" style={{ minWidth: 200 }} value={data.defaultResumeVariantId || undefined} options={data.resumeVariants.map(v => ({ value: v.id, label: v.name }))}
        onChange={defaultResumeVariantId => useDataStore.getState().setResumeRouting({ defaultResumeVariantId })} />
    </Space>
    {data.resumeVariants.map(v => <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <Space wrap><Typography.Text strong>{v.name}</Typography.Text><Tag>{v.kind === 'python' ? 'Python / 自动化' : v.kind === 'ai_application' ? 'AI 应用 / Vibe Coding' : '通用'}</Tag>{selectedId === v.id && <Tag color="blue">正在编辑</Tag>}</Space>
      <Space wrap><Button onClick={() => onSelect(v.id)}>编辑正文</Button><Button onClick={() => setEditing({ ...v })}>名称与方向</Button><Button loading={exporting === v.id} disabled={!!exporting} onClick={() => void exportPdf(v)}>导出 PDF</Button><Button danger onClick={() => Modal.confirm({ title: `删除基础简历“${v.name}”？`, content: '已生成的历史结果保留。绑定此版本的图片附件将停止自动发送。', onOk: () => { if (selectedId === v.id) onSelect(data.resumeVariants.find(other => other.id !== v.id)?.id || ''); useDataStore.getState().removeResumeVariant(v.id); } })}>删除</Button></Space>
    </div>)}
    <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}>每份基础简历分别保存。单岗和批量定制、岗位分析及招呼语按岗位选版；未识别方向时使用默认版本，也可在定制页面手动指定。平台在线简历需在招聘平台内维护。</Typography.Paragraph>
    <Modal title="基础简历版本" open={!!editing} onCancel={() => setEditing(null)} onOk={() => {
      if (!editing?.name.trim() || !editing.text.trim()) { message.warning('请填写版本名称与正文'); return; }
      useDataStore.getState().upsertResumeVariant({ ...editing, name: editing.name.trim(), updatedAt: Date.now() });
      onSelect(editing.id); setEditing(null); message.success('基础简历版本已保存');
    }}>
      {editing && <Space direction="vertical" style={{ width: '100%' }}>
        <Input aria-label="版本名称" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} maxLength={40} />
        <Select aria-label="简历方向" style={{ width: '100%' }} value={editing.kind} options={[{ value: 'python', label: 'Python 开发与自动化' }, { value: 'ai_application', label: 'AI 应用 / Vibe Coding' }, { value: 'general', label: '通用（默认或手动选择）' }]} onChange={kind => setEditing({ ...editing, kind })} />
        <Input.TextArea aria-label="版本正文" value={editing.text} rows={12} onChange={e => setEditing({ ...editing, text: e.target.value })} />
      </Space>}
    </Modal>
  </Card>;
}
