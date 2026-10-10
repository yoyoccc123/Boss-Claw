import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'bossclaw-filters-test-'));
const require = createRequire(import.meta.url);
try {
  const outfile = join(temporary, 'bundle.cjs');
  await build({ stdin: { contents: "export * from './src/lib/bossclaw/addressRisk'; export * from './src/lib/bossclaw/workbenchFilters'; export * from './src/lib/bossclaw/companySize'; export * from './src/lib/bossclaw/tailorJob'; export * from './src/lib/bossclaw/tailorBatch';", resolveDir: root, loader: 'ts' }, tsconfig: join(root, 'tsconfig.json'), bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'silent' });
  const { assessJobAddress, addressFromJobText, filterWorkbenchJobs, matchesWorkbenchSalary, isWorkbenchJobIncluded, companySizeOfJob, listTailorJobs, runTailorBatch, createTailorBatch } = require(outfile);
  for (const address of ['广州市岑村东街12号民房二楼', '南村镇里仁洞村38号2栋', '广州春晖花园3栋1单元', '广州青年公寓302室']) assert.equal(assessJobAddress({ address }).suspicious, true, address);
  for (const job of [{ location: '广州·天河区·岑村' }, { address: '中关村大街1号科技园' }, { address: '广州市黄埔区芯大厦B3栋406' }, { address: '南村工业园1栋' }, { description: '项目地址：https://github.com/xxx；招聘2人' }]) assert.equal(assessJobAddress(job).suspicious, false, JSON.stringify(job));
  assert.equal(addressFromJobText('工作地点】广州市【招聘人数】2人，需熟悉中心组件'), '');
  assert.equal(addressFromJobText('工作地点：广州市黄埔区芯大厦B3栋406\n任职要求：Python'), '广州市黄埔区芯大厦B3栋406');
  assert.equal(assessJobAddress({ companyAddress: '城中村民房12号' }).address, '', '不读取公司注册地址');
  assert.equal(assessJobAddress({ address: '南村镇附近2号线地铁站' }).suspicious, false);
  assert.equal(addressFromJobText('工作地点：南村镇附近2号线地铁站'), '');
  assert.equal(matchesWorkbenchSalary({ salary: '150-200元/天', welfare: ['周末双休'] }, { salaryUnit: 'monthly', salaryMin: 3300, salaryMax: 3300 }), true);
  assert.equal(matchesWorkbenchSalary({ salary: '6-10K' }, { salaryMin: 7000 }), false);
  assert.equal(matchesWorkbenchSalary({ salary: '面议' }, { salaryMin: 9000, keepUnknownSalary: false }), false);
  assert.equal(matchesWorkbenchSalary({ salary: '6-10K' }, { salaryMin: 9000, salaryMax: 8000 }), false);
  assert.equal(companySizeOfJob({ scaleName: '100-499人' }).low, 100);
  assert.equal(companySizeOfJob({ companySize: '少于20人' }).low, 0);
  assert.equal(companySizeOfJob({ companySize: '10000人以上' }).high, Infinity);
  assert.equal(companySizeOfJob({ companySize: '301', description: '招聘人数：3人；团队人数：20人' }), null);
  assert.equal(isWorkbenchJobIncluded({ companySize: '20-99人' }, { companyMin: 100 }), false);
  assert.equal(isWorkbenchJobIncluded({}, { keepUnknownCompanySize: false }), false);
  const jobs = [
    { id: 'home', status: 'pending', job: { title: 'Agent开发', company: '小公司', address: '广州岑村12号民房', salary: '6-10K', companySize: '20-99人' } },
    { id: 'office', status: 'pending', job: { title: 'Agent开发', company: '大公司', address: '广州芯大厦B3栋406', salary: '6-10K', companySize: '100-499人' } },
    { id: 'low', status: 'sent', job: { salary: '3-5K', companySize: '100-499人' } },
  ];
  const preferences = { hideResidential: true, salaryMin: 5000, companyMin: 100 };
  assert.deepEqual(filterWorkbenchJobs(jobs, preferences).map(p => p.id), ['office']);
  assert.deepEqual(listTailorJobs(jobs, 'home', preferences).map(p => p.id), ['office'], '直接选择也不能绕过工作台筛选');
  assert.equal(jobs[0].status, 'pending', '筛选不修改原始状态');
  const generated = [], updates = [];
  await runTailorBatch(createTailorBatch(jobs, ['home', 'office']), async item => { generated.push(item.id); return { method: 'local' }; }, {
    shouldStop: () => false, shouldSkip: item => isWorkbenchJobIncluded(item.job, preferences) ? undefined : '已筛除', onUpdate: item => updates.push(item), onResult: () => {},
  });
  assert.deepEqual(generated, ['office']); assert.equal(updates[0].status, 'filtered');
  const office = require(join(root, 'electron/preload/office-address.cjs'));
  const size = require(join(root, 'electron/preload/company-size.cjs'));
  assert.equal(office.officeAddressFromPayload({ data: { address: '广州岑村12号民房', companyInfo: { address: '广州岑村12号' } } }), '');
  assert.equal(office.officeAddressFromPayload({ zpData: { jobInfo: { address: '广州市芯大厦B3栋406' } } }), '广州市芯大厦B3栋406');
  assert.equal(office.officeAddressFromPayload({ data: { detailedPosition: { address: '广州' } } }), '');
  assert.equal(size.companySizeFromPayload({ zpData: { brandComInfo: { scaleName: '100-499人' } } }), '100-499人');
  assert.equal(size.companySizeLabel('招聘人数：3-5人'), '');
  const { readOfficeAddress } = require(join(root, 'electron/preload/office-address-reader.cjs'));
  let requests = 0;
  const context = { platform: 'boss', fetchJson: async () => { requests++; return { code: 0, zpData: { jobInfo: { address: '广州芯大厦12楼' }, brandComInfo: { scaleName: '100-499人' } } }; }, fetchSource: async () => { throw new Error('不得额外请求'); }, parseHtml: () => null };
  const job = { platform: 'boss', url: 'https://www.zhipin.com/job_detail/test123.html' };
  assert.deepEqual(await readOfficeAddress(job, context), { address: '广州芯大厦12楼', companySize: '100-499人' });
  assert.equal(requests, 1);
  assert.equal((await readOfficeAddress({ ...job, url: 'https://example.com/job_detail/test.html' }, context)).error, '岗位链接不属于支持的招聘平台');
  assert.equal(requests, 1);
  assert.equal((await readOfficeAddress(job, { ...context, fetchJson: async () => ({ code: 37 }) })).stop, true);
  assert.equal((await readOfficeAddress({ ...job, platform: 'liepin' }, context)).error, '请在对应招聘平台的标签页补齐地址');
  console.log('PASS workbench: 地址证据/误标边界、薪水换算、公司人数、统一选择/生成筛选、只读详情与风险停止。');
} finally { rmSync(temporary, { recursive: true, force: true }); }
