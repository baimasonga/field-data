// Copyright 2026 Field Data Developers
// Licensed under the Apache License, Version 2.0.

const { strict: assert } = require('assert');
const { answers, compareAnswers, compareMappedAnswers, validatePairs, MAX_BYTES } = require('../../../lib/util/backcheck-comparison');

describe('backcheck answer comparison', () => {
  it('distinguishes changed, missing, empty and unchanged exact text, excluding metadata', () => {
    const result = compareAnswers('<data><meta><instanceID>one</instanceID></meta><name>Alice &amp; Bob</name><age>30</age><empty/><left> </left></data>',
      '<data><meta><instanceID>two</instanceID></meta><name><![CDATA[Alice & Bob]]></name><age>31</age><empty/><right/></data>');
    assert.deepEqual(result.summary, { same: 2, changed: 1, missingOriginal: 1, missingBackcheck: 1 });
    assert.deepEqual(result.rows.find(row => row.path === '/left[1]'),
      { path: '/left[1]', original: ' ', backcheck: null, status: 'missingBackcheck' });
    assert.equal(result.rows.find(row => row.path === '/right[1]').backcheck, '');
    assert.ok(result.rows.every(row => !row.path.includes('instanceID')));
  });

  it('aligns nested repeats by position and preserves extra repeat entries', () => {
    const result = compareAnswers('<data><people><person><name>A</name></person><person><name>B</name></person></people></data>',
      '<data><people><person><name>B</name></person></people></data>');
    assert.deepEqual(result.rows.map(row => [row.path, row.status]),
      [['/people[1]/person[1]/name[1]', 'changed'], ['/people[1]/person[2]/name[1]', 'missingBackcheck']]);
  });

  it('normalizes namespace prefixes without conflating distinct namespace URIs', () => {
    const result = compareAnswers('<data xmlns:a="urn:a"><a:name>A</a:name></data>',
      '<data xmlns:b="urn:a" xmlns:c="urn:c"><b:name>A</b:name><c:name>C</c:name></data>');
    assert.equal(result.summary.same, 1);
    assert.equal(result.summary.missingOriginal, 1);
    assert.equal(result.rows[0].path, '/{urn%3Aa}name[1]');
  });

  it('rejects malformed, DTD and mixed-content XML without loading external content', () => {
    for (const xml of ['<data><a></data>', '<!DOCTYPE data SYSTEM "file:///etc/passwd"><data/>',
      '<data><a>mixed<b/>text</a></data>', '<data>unexpected root text</data>']) {
      assert.throws(() => compareAnswers(xml, '<data/>'), { reason: 'unsupported-xml' });
    }
  });

  it('bounds source size, depth, fields and expanded response size without partial output', () => {
    for (const xml of ['x'.repeat(MAX_BYTES + 1), '<a>'.repeat(65) + '</a>'.repeat(65),
      `<data>${'<a/>'.repeat(5001)}</data>`]) {
      assert.throws(() => compareAnswers(xml, '<data/>'), { reason: 'size-limit' });
    }
    assert.throws(() => compareAnswers(`<data xmlns="${'u'.repeat(9000)}"><a/></data>`, '<data/>'),
      { reason: 'size-limit' });
    const xml = `<data>${'<aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>'.repeat(50)}${'<x/>'.repeat(2000)}${'</aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa>'.repeat(50)}</data>`;
    assert.throws(() => compareAnswers(xml, xml), { reason: 'size-limit' });
  });
});

describe('explicit backcheck field mappings', () => {
  const original = '<data><age>30</age><name>A</name><person><age>40</age></person><person><age>50</age></person></data>';
  const backcheck = '<data><verified_age>31</verified_age><name>A</name><person><age>50</age></person></data>';
  it('compares selected renamed fields and explicit repeat positions, retaining unmapped fields', () => {
    const pairs = [{ originalPath: '/age[1]', backcheckPath: '/verified_age[1]', label: 'Age' },
      { originalPath: '/person[2]/age[1]', backcheckPath: '/person[1]/age[1]', label: 'Second person' },
      { originalPath: '/absent[1]', backcheckPath: '/name[1]', label: 'Missing original' },
      { originalPath: '/name[1]', backcheckPath: '/absent[1]', label: 'Missing check' }];
    assert.equal(validatePairs(pairs, answers(original), answers(backcheck)), true);
    const result = compareMappedAnswers(original, backcheck, pairs);
    assert.deepEqual(result.summary, { same: 1, changed: 1, missingOriginal: 1,
      missingBackcheck: 1, unmappedOriginal: 1, unmappedBackcheck: 0 });
    assert.equal(result.rows[0].original, '30');
    assert.equal(result.rows[0].backcheck, '31');
  });
  it('keeps identical names on different forms independently unmapped without explicit pairs', () => {
    const result = compareMappedAnswers(original, backcheck, []);
    assert.equal(result.summary.same, 0);
    assert.equal(result.summary.unmappedOriginal, 4);
    assert.equal(result.summary.unmappedBackcheck, 3);
    assert.equal(new Set(result.rows.map(row => row.path)).size, result.rows.length);
  });
  it('rejects expressions, metadata, duplicate paths, oversized maps and pairs absent on both sides', () => {
    const pair = { originalPath: '/age[1]', backcheckPath: '/verified_age[1]', label: '' };
    for (const pairs of [[pair, pair], Array(101).fill(pair),
      [{ ...pair, originalPath: '/meta[1]/instanceID[1]' }],
      [{ ...pair, originalPath: '/person[*]/age[1]' }],
      [{ ...pair, originalPath: '/age[0]' }],
      [{ ...pair, originalPath: '/{urn%ZZ}age[1]' }],
      [{ ...pair, originalPath: '/none[1]', backcheckPath: '/none[1]' }],
      [{ ...pair, label: 'x'.repeat(101) }]])
      assert.equal(validatePairs(pairs, answers(original), answers(backcheck)), false);
    assert.equal(validatePairs([{ originalPath: '/{urn%3Aa}name[1]', backcheckPath: '/名字[1]', label: '' }],
      new Map([['/{urn%3Aa}name[1]', 'A']]), new Map([['/名字[1]', 'A']])), true);
  });
  it('retains output bounds even when every field is independently unmapped', () => {
    const xml = `<data>${'<a/>'.repeat(2501)}</data>`;
    assert.throws(() => compareMappedAnswers(xml, xml, []), { reason: 'size-limit' });
  });
});
