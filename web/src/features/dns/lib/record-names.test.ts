import { describe, expect, it } from 'vitest'
import { parseRecordNames } from './record-names'

describe('parseRecordNames', () => {
  it('按空格、半角逗号、全角逗号切分并保持出现顺序', () => {
    expect(parseRecordNames('www, @，mail api')).toEqual(['www', '@', 'mail', 'api'])
  })

  it('重复名称只保留第一次出现', () => {
    expect(parseRecordNames('www  www,www，@')).toEqual(['www', '@'])
    expect(parseRecordNames(' a , a , b ')).toEqual(['a', 'b'])
  })

  it('连续分隔符、换行与制表符同样切分且不产生空名', () => {
    expect(parseRecordNames('a,,,b\n c\td')).toEqual(['a', 'b', 'c', 'd'])
    expect(parseRecordNames('  a , , b  ')).toEqual(['a', 'b'])
  })

  it('名称大小写敏感：A 与 a 是两条不同名称', () => {
    expect(parseRecordNames('A,a,A')).toEqual(['A', 'a'])
  })

  it('空串、纯分隔符、undefined、null 都返回空数组', () => {
    expect(parseRecordNames('')).toEqual([])
    expect(parseRecordNames('   ,，，\n')).toEqual([])
    expect(parseRecordNames(undefined)).toEqual([])
    expect(parseRecordNames(null)).toEqual([])
  })

  it('非字符串输入按 String 归一后再切分', () => {
    expect(parseRecordNames(123)).toEqual(['123'])
    expect(parseRecordNames(['www', 'api'])).toEqual(['www', 'api'])
  })
})
