import { useState } from 'react';
import { Alert, Card, InputNumber, Select, Switch, Tooltip, Typography } from 'antd';
import { LockOutlined, FieldTimeOutlined, ThunderboltOutlined, HourglassOutlined,
  ClockCircleOutlined, CoffeeOutlined, InfoCircleOutlined, DesktopOutlined, MessageOutlined } from '@ant-design/icons';
import { useSettingsStore } from '@/store/useSettingsStore';
import { isLockedOut, cooldownRemaining, SAFETY_LIMITS } from '@/lib/bossclaw/safety';
import { DEFAULT_ACTIVE_HOURS, DEFAULT_BATCH_REST } from '@/lib/bossclaw/activityWindow';
import BossBrowseLimitSettings from './BossBrowseLimitSettings';
import { normalizeRandomWaits, platformRandomWaits, type PlatformRandomWaitSettings, type WaitRange } from '@/lib/bossclaw/randomWait';
import { PLATFORM_IDS, platformLabel } from '@/lib/bossclaw/platforms';
import type { JobPlatform } from '@/lib/bossclaw/types';

function RandomWaitRange({ label, value, max, disabled, onChange }: {
  label: string; value: WaitRange; max: number; disabled?: boolean; onChange: (range: WaitRange) => void;
}) {
  return <div className="stat-input-card">
    <span className="sic-label">{label}</span>
    <div className="sic-input-wrap">
      <InputNumber aria-label={`${label}最少秒数`} min={0} max={max} step={0.1} precision={1}
        value={value.minSeconds} disabled={disabled} style={{ width: 90 }}
        onChange={n => { const minSeconds = n ?? value.minSeconds; onChange({ minSeconds, maxSeconds: Math.max(minSeconds, value.maxSeconds) }); }} />
      <span className="sic-unit">至</span>
      <InputNumber aria-label={`${label}最多秒数`} min={0} max={max} step={0.1} precision={1}
        value={value.maxSeconds} disabled={disabled} style={{ width: 90 }}
        onChange={n => { const maxSeconds = n ?? value.maxSeconds; onChange({ minSeconds: Math.min(value.minSeconds, maxSeconds), maxSeconds }); }} />
      <span className="sic-unit">秒</span>
    </div>
  </div>;
}

/** Shared presentation only: browse and delivery gates keep their existing policies. */
export default function SafetyPacingSettings() {
  const config = useSettingsStore(s => s.config);
  const setConfig = useSettingsStore(s => s.setConfig);
  const activeHoursCfg = config.activeHours ?? DEFAULT_ACTIVE_HOURS;
  const [waitPlatform, setWaitPlatform] = useState<JobPlatform>('boss');
  const randomWaits = platformRandomWaits(config.randomWaits, waitPlatform);
  const changeWait = (patch: Partial<PlatformRandomWaitSettings>) => {
    const saved = normalizeRandomWaits(useSettingsStore.getState().config.randomWaits);
    setConfig({ randomWaits: { ...saved, platforms: { ...saved.platforms,
      [waitPlatform]: { ...platformRandomWaits(saved, waitPlatform), ...patch },
    } } });
  };
  const activeHoursPerDay = ((activeHoursCfg.endHour - activeHoursCfg.startHour + 24) % 24) || 24;
  return <Card size="small" className="setting-card safety-pacing-settings" data-testid="safety-pacing-settings"
    title={<><LockOutlined style={{ color: 'var(--brand)', marginRight: 6 }} />访问与投递节奏</>}>
    <BossBrowseLimitSettings policy={config.bossBrowseLimit ?? { windowMinutes: 30, maxViews: 30 }}
      onApply={value => setConfig({ bossBrowseLimit: value })} />
    <section className="safety-pacing-delivery" aria-label="按平台随机等待">
      <Typography.Title level={5} style={{ margin: '0 0 12px', fontSize: 15 }}>按平台随机等待</Typography.Title>
      <Select aria-label="随机等待设置平台" value={waitPlatform} onChange={setWaitPlatform}
        style={{ width: '100%', maxWidth: 260, marginBottom: 12 }}
        options={PLATFORM_IDS.map(id => ({ value: id, label: platformLabel(id) }))} />
      <Typography.Paragraph type="secondary">当前设置仅用于{platformLabel(waitPlatform)}的工作台内置浏览器，自动保存。各平台、采集与投递分别设置；关闭后保留原范围。</Typography.Paragraph>
      <div className="sic-row-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <b>采集随机等待</b>
        <Switch aria-label="当前平台采集随机等待" checked={randomWaits.collectionEnabled}
          onChange={enabled => changeWait({ collectionEnabled: enabled })} />
      </div>
      <div className="sic-rows">
        <RandomWaitRange label="采集岗位间等待" value={randomWaits.collectionJob} max={300} disabled={!randomWaits.collectionEnabled} onChange={range => changeWait({ collectionJob: range })} />
        <RandomWaitRange label="采集步骤间等待" value={randomWaits.collectionStep} max={15} disabled={!randomWaits.collectionEnabled} onChange={range => changeWait({ collectionStep: range })} />
      </div>
      <div className="sic-row-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '12px 0' }}>
        <b>投递步骤随机等待</b>
        <Switch aria-label="当前平台投递步骤随机等待" checked={randomWaits.deliveryEnabled}
          onChange={enabled => changeWait({ deliveryEnabled: enabled })} />
      </div>
      <div className="sic-rows">
        <RandomWaitRange label="投递步骤间等待" value={randomWaits.deliveryStep} max={15} disabled={!randomWaits.deliveryEnabled} onChange={range => changeWait({ deliveryStep: range })} />
      </div>
      <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>每次在范围内随机取值，0 至 0 可单独关闭某一项。采集修改从下一次等待生效，暂停或停止可打断。投递步骤等待用于打开沟通、填写和发送之前。</Typography.Paragraph>
    </section>
    <section className="safety-pacing-delivery" aria-label="投递与沟通节奏">
      <Typography.Title level={5} style={{ margin: '0 0 12px', fontSize: 15 }}>投递与沟通节奏</Typography.Title>
      {isLockedOut(config) && (
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 8, marginBottom: 12 }}
          message={`账号处于冷却期，剩余约 ${Math.ceil(cooldownRemaining(config) / 60000)} 分钟`}
        />
      )}
      <div className="sic-scope">
        <InfoCircleOutlined />
        <span>
          生效范围：<DesktopOutlined style={{ margin: '0 2px' }} /><b>工作台投递</b>
          <span style={{ margin: '0 6px' }}>+</span>
          <MessageOutlined style={{ marginRight: 2 }} /><b>自动沟通</b>
          <span style={{ marginLeft: 6 }}>—— 两者共用同一套限制，改一处两边同时生效</span>
        </span>
      </div>

      <div className="sic-tiles">
        <div className="stat-input-card">
          <span className="sic-label">
            <FieldTimeOutlined className="sic-icon" />
            岗位间隔
          </span>
          <div className="sic-input-wrap">
            <InputNumber
              aria-label="投递岗位间隔（秒）"
              min={15}
              max={600}
              value={config.betweenJobsSeconds}
              onChange={(v) => setConfig({ betweenJobsSeconds: v ?? 20 })}
              style={{ flex: 1, minWidth: 0 }}
            />
            <span className="sic-unit">秒</span>
          </div>
        </div>

        <div className="stat-input-card">
          <span className="sic-label">
            <ThunderboltOutlined className="sic-icon" />
            每分动作
          </span>
          <div className="sic-input-wrap">
            <InputNumber
              aria-label="投递与沟通每分钟动作数"
              min={1}
              max={SAFETY_LIMITS.MAX_ACTIONS_PER_MINUTE}
              value={config.maxActionsPerMinute}
              onChange={(v) => setConfig({ maxActionsPerMinute: Math.min(SAFETY_LIMITS.MAX_ACTIONS_PER_MINUTE, Math.max(1, v ?? 6)) })}
              style={{ flex: 1, minWidth: 0 }}
            />
            <span className="sic-unit">次/分</span>
          </div>
        </div>

        <div className="stat-input-card">
          <span className="sic-label">
            <HourglassOutlined className="sic-icon" />
            风控冷却
            <Tooltip title="调大可延长冷却时长；不会缩短各风险码的保护下限">
              <InfoCircleOutlined className="sic-hint" />
            </Tooltip>
          </span>
          <div className="sic-input-wrap">
            <InputNumber
              aria-label="投递与沟通风控冷却（分钟）"
              min={30}
              max={720}
              value={config.autoCooldownMinutes}
              onChange={(v) => setConfig({ autoCooldownMinutes: v ?? 30 })}
              style={{ flex: 1, minWidth: 0 }}
            />
            <span className="sic-unit">分钟</span>
          </div>
        </div>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginTop: 10 }}>岗位间隔以设定值为基准随机浮动。上方随机等待开关不影响岗位间隔、浏览限额和批次休息。</Typography.Paragraph>

      <div className="sic-rows">
        <div className="stat-input-card">
          <div className="sic-row-head">
            <span className="sic-label">
              <ClockCircleOutlined className="sic-icon" />
              活跃时段
            </span>
            <Switch
              aria-label="投递与沟通活跃时段"
              size="small"
              checked={config.activeHours?.enabled !== false}
              onChange={(v) => setConfig({ activeHours: { ...(config.activeHours ?? DEFAULT_ACTIVE_HOURS), enabled: v } })}
            />
          </div>
          <div className="sic-input-wrap">
            <InputNumber
              min={0}
              max={23}
              style={{ width: 64 }}
              disabled={config.activeHours?.enabled === false}
              value={config.activeHours?.startHour ?? DEFAULT_ACTIVE_HOURS.startHour}
              onChange={(v) => setConfig({ activeHours: { ...(config.activeHours ?? DEFAULT_ACTIVE_HOURS), startHour: v ?? DEFAULT_ACTIVE_HOURS.startHour } })}
            />
            <span className="sic-unit">至</span>
            <InputNumber
              min={0}
              max={23}
              style={{ width: 64 }}
              disabled={config.activeHours?.enabled === false}
              value={config.activeHours?.endHour ?? DEFAULT_ACTIVE_HOURS.endHour}
              onChange={(v) => setConfig({ activeHours: { ...(config.activeHours ?? DEFAULT_ACTIVE_HOURS), endHour: v ?? DEFAULT_ACTIVE_HOURS.endHour } })}
            />
            <span className="sic-unit">点</span>
            <span className="sic-note">每天约 {activeHoursPerDay} 小时</span>
          </div>
        </div>

        <div className="stat-input-card">
          <div className="sic-row-head">
            <span className="sic-label">
              <CoffeeOutlined className="sic-icon" />
              批次休息
            </span>
            <Switch
              aria-label="投递与沟通批次休息"
              size="small"
              checked={config.batchRest?.enabled !== false}
              onChange={(v) => setConfig({ batchRest: { ...(config.batchRest ?? DEFAULT_BATCH_REST), enabled: v } })}
            />
          </div>
          <div className="sic-input-wrap">
            <span className="sic-unit">每</span>
            <InputNumber
              min={3}
              max={200}
              style={{ width: 62 }}
              disabled={config.batchRest?.enabled === false}
              value={config.batchRest?.everyNJobs ?? DEFAULT_BATCH_REST.everyNJobs}
              onChange={(v) => setConfig({ batchRest: { ...(config.batchRest ?? DEFAULT_BATCH_REST), everyNJobs: v ?? DEFAULT_BATCH_REST.everyNJobs } })}
            />
            <span className="sic-unit">个休息</span>
            <InputNumber
              min={1}
              max={60}
              style={{ width: 62 }}
              disabled={config.batchRest?.enabled === false}
              value={config.batchRest?.minMinutes ?? DEFAULT_BATCH_REST.minMinutes}
              onChange={(v) => setConfig({ batchRest: { ...(config.batchRest ?? DEFAULT_BATCH_REST), minMinutes: v ?? DEFAULT_BATCH_REST.minMinutes } })}
            />
            <span className="sic-unit">–</span>
            <InputNumber
              min={1}
              max={60}
              style={{ width: 62 }}
              disabled={config.batchRest?.enabled === false}
              value={config.batchRest?.maxMinutes ?? DEFAULT_BATCH_REST.maxMinutes}
              onChange={(v) => setConfig({ batchRest: { ...(config.batchRest ?? DEFAULT_BATCH_REST), maxMinutes: v ?? DEFAULT_BATCH_REST.maxMinutes } })}
            />
            <span className="sic-unit">分钟</span>
          </div>
        </div>
      </div>
    </section>
  </Card>;
}
