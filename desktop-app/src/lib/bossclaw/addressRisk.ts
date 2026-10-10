import type { JobMeta } from './types';

export interface AddressAssessment {
  address: string;
  source: 'address' | 'description' | 'location' | 'unknown';
  suspicious: boolean;
  reasons: string[];
}

const ADDRESS_LABEL = /(?:工作地址|办公地址|上班地址|公司地址|办公地点|上班地点|工作地点|公司地点|职位地点)\s*[：:】\]]?\s*/g;
const DETAIL = /路|街|巷|弄|号(?!线)|栋|幢|楼|大厦|中心|产业园|工业园|科技园|公寓|小区|住宅|城中村|民房|自建房/;
const COMMERCIAL = /写字楼|大厦|商务中心|办公楼|(?:科技|产业|工业|软件|创新|创业|创意|商业)园|工业区|科创(?:园|中心)|商用公寓|中关村/;

function cleanAddress(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').replace(/^(?:工作地址|办公地址|公司地址)\s*[:：]?\s*/, '')
    .split(/查看地图|导航|附近地铁|点击查看|[【\[]|(?:任职要求|岗位职责|招聘要求|职位描述|福利待遇|投递要求|招聘人数)[：:】]?|\s+\S{1,8}\s+(?:刚刚活跃|今日活跃|招聘专家)/)[0].trim().slice(0, 180);
}

/** 存量 JD 只读取明确的地点标签，不把项目地址、村名地铁站或公司名称当作办公地址。 */
export function addressFromJobText(value: unknown): string {
  if (typeof value !== 'string') return '';
  for (const match of value.matchAll(ADDRESS_LABEL)) {
    const start = (match.index ?? 0) + match[0].length;
    const address = cleanAddress(value.slice(start).split(/[\r\n]/)[0]);
    if (DETAIL.test(address)) return address;
  }
  return '';
}

export function assessJobAddress(job: JobMeta): AddressAssessment {
  let address = cleanAddress(job.address || job.workAddress);
  if (!DETAIL.test(address)) address = '';
  let source: AddressAssessment['source'] = address ? 'address' : 'unknown';
  if (!address) {
    address = addressFromJobText(job.description) || addressFromJobText(job.cardText);
    if (address) source = 'description';
  }
  if (!address) {
    const location = cleanAddress(job.location);
    if (DETAIL.test(location) && !/^[^·•/]+[·•/][^·•/]+(?:[·•/][^·•/]+)?$/.test(location)) {
      address = location; source = 'location';
    }
  }
  const reasons: string[] = [];
  if (address) {
    const explicit = address.match(/城中村|民房|自建房|农民房|私人住宅|居民楼|住宅楼|住宅区|居民区|宅基地/);
    if (explicit) reasons.push(`地址含“${explicit[0]}”`);
    if (!COMMERCIAL.test(address)) {
      const residential = address.match(/小区|家属院|住宅公寓|居民公寓|(?:花园|新村|苑|家园).{0,10}(?:\d+\s*(?:栋|幢|单元)|[A-Z]\s*(?:栋|座))/i);
      if (residential) reasons.push(`地址含住宅特征“${residential[0]}”`);
      const village = address.match(/[\u4e00-\u9fa5]{1,8}村(?:[一二三四五六七八九十\d]+(?:社|组|队))?(?:[^，,；;]{0,18}(?:\d+\s*号(?!线)|\d+\s*(?:栋|幢)|自建房|出租屋|民房|农民房))/);
      if (village) reasons.push(`村内门牌地址“${village[0]}”`);
      const apartment = address.match(/公寓.{0,14}(?:\d+\s*单元|\d{3,5}\s*(?:室|房))/);
      if (apartment) reasons.push(`公寓房间地址“${apartment[0]}”`);
    }
  }
  return { address, source, suspicious: reasons.length > 0, reasons: [...new Set(reasons)] };
}
