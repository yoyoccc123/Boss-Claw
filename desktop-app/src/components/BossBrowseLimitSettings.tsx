import { useEffect, useState } from 'react';
import { Button, InputNumber, Space, Typography, message } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { electronApi } from '@/lib/electronApi';

type Policy = { windowMinutes: number; maxViews: number };

export default function BossBrowseLimitSettings({ policy, onApply }: { policy: Policy; onApply: (value: Policy) => void }) {
  const [minutes, setMinutes] = useState<number | null>(policy.windowMinutes);
  const [views, setViews] = useState<number | null>(policy.maxViews);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMinutes(policy.windowMinutes); setViews(policy.maxViews); }, [policy.windowMinutes, policy.maxViews]);
  const valid = Number.isInteger(minutes) && minutes! >= 1 && minutes! <= 1440
    && Number.isInteger(views) && views! >= 1 && views! <= 1000;
  const changed = minutes !== policy.windowMinutes || views !== policy.maxViews;
  const apply = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const next = { windowMinutes: minutes!, maxViews: views! };
      const result = await electronApi.bossBrowse.call('configure', next);
      if (result.error) { message.error(result.error); return; }
      onApply(next);
      message.success('浏览限额已应用，当前等待时间将按新设置重新计算');
    } finally { setSaving(false); }
  };
  return <div className="settings-section-card" data-testid="boss-browse-limit-settings">
    <div className="settings-section-header"><div className="settings-section-header__title">
      <div className="section-icon-box"><SafetyCertificateOutlined /></div>BOSS 浏览频率限制
    </div></div>
    <Typography.Paragraph>当前生效：每 <strong>{policy.windowMinutes}</strong> 分钟最多查看 <strong>{policy.maxViews}</strong> 个岗位</Typography.Paragraph>
    <div className="settings-grid">
      <div className="sg-item"><label className="field-label" htmlFor="boss-browse-minutes">BOSS 浏览计数周期（分钟）</label>
        <InputNumber id="boss-browse-minutes" aria-label="BOSS 浏览计数周期（分钟）" min={1} max={1440} precision={0} disabled={saving}
          value={minutes} onChange={setMinutes} style={{ width: '100%' }} /></div>
      <div className="sg-item"><label className="field-label" htmlFor="boss-browse-views">周期内最多查看岗位数</label>
        <InputNumber id="boss-browse-views" aria-label="周期内最多查看岗位数" min={1} max={1000} precision={0} disabled={saving}
          value={views} onChange={setViews} style={{ width: '100%' }} /></div>
    </div>
    <Space style={{ marginTop: 12 }}><Button type="primary" loading={saving} disabled={!valid || !changed} onClick={apply}>应用浏览限额</Button>
      <Typography.Text type="secondary">修改两项后点击应用，无需重启。</Typography.Text></Space>
    <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
      按最近一个周期内的浏览记录累计。达到上限后，等待本轮全部记录到期再继续，期间不使用逐条释放的名额。
      恢复时间为本轮最后一次查看时间加上计数周期。修改周期或次数会重新计算等待时间，历史计数保留。
      计数跨城市、方向和重启共用；平台要求的访问限制和验证仍按平台提示处理。
    </Typography.Paragraph>
  </div>;
}
