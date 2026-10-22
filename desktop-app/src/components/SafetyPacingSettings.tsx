import { Alert, Card, InputNumber, Switch, Tooltip, Typography } from 'antd';
import { LockOutlined, FieldTimeOutlined, ThunderboltOutlined, HourglassOutlined,
  ClockCircleOutlined, CoffeeOutlined, InfoCircleOutlined, DesktopOutlined, MessageOutlined } from '@ant-design/icons';
import { useSettingsStore } from '@/store/useSettingsStore';
import { isLockedOut, cooldownRemaining, SAFETY_LIMITS } from '@/lib/bossclaw/safety';
import { DEFAULT_ACTIVE_HOURS, DEFAULT_BATCH_REST } from '@/lib/bossclaw/activityWindow';
import BossBrowseLimitSettings from './BossBrowseLimitSettings';

/** Shared presentation only: browse and delivery gates keep their existing policies. */
export default function SafetyPacingSettings() {
  const config = useSettingsStore(s => s.config);
  const setConfig = useSettingsStore(s => s.setConfig);
  const activeHoursCfg = config.activeHours ?? DEFAULT_ACTIVE_HOURS;
  const activeHoursPerDay = ((activeHoursCfg.endHour - activeHoursCfg.startHour + 24) % 24) || 24;
  return <Card size="small" className="setting-card safety-pacing-settings" data-testid="safety-pacing-settings"
    title={<><LockOutlined style={{ color: 'var(--brand)', marginRight: 6 }} />访问与投递节奏</>}>
    <BossBrowseLimitSettings policy={config.bossBrowseLimit ?? { windowMinutes: 30, maxViews: 30 }}
      onApply={value => setConfig({ bossBrowseLimit: value })} />
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
