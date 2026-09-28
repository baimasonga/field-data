const Should = require('should'); // eslint-disable-line no-unused-vars
const zlib = require('node:zlib');
const { assertBoundedArchive, _readEntries } = require('../../../lib/util/zip-bounds');

/*
Zips are built here by hand rather than with a library, for two reasons: the
test then depends on nothing, and it can write a header that lies, which is
the case the declared sizes alone cannot catch.
*/
const zipOf = (entries) => {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, content, declare } of entries) {
    const raw = Buffer.from(content);
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const declared = declare ?? raw.length;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt32LE(deflated.length, 18);
    header.writeUInt32LE(declared, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    local.push(header, nameBuf, deflated);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(deflated.length, 20);
    entry.writeUInt32LE(declared, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += header.length + nameBuf.length + deflated.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
};

const LIMITS = { maxTotalBytes: 1024 * 1024, maxEntries: 8 };

describe('(util) zip bounds', () => {
  it('reads what the central directory declares', () => {
    const entries = _readEntries(zipOf([
      { name: 'a.xml', content: 'hello' },
      { name: 'b/c.xml', content: 'world!' }
    ]));
    entries.map(entry => entry.name).should.eql(['a.xml', 'b/c.xml']);
    entries.map(entry => entry.uncompressedSize).should.eql([5, 6]);
  });

  it('lets an ordinary workbook through', async () => {
    const result = await assertBoundedArchive(
      zipOf([{ name: 'xl/worksheets/sheet1.xml', content: '<worksheet/>' }]), LIMITS
    );
    result.entries.should.equal(1);
    result.inflatedBytes.should.equal(12);
  });

  /*
  The measurement that matters. A limit on the upload is a limit on compressed
  bytes, and compressed bytes are not what costs memory: a valid workbook of a
  third of a megabyte expanded to 92.7 MB of XML and 735 MB of resident memory
  in ExcelJS, from three per cent of the ten megabytes templates are allowed.
  */
  it('refuses an archive that expands past the budget', async () => {
    const bomb = zipOf([{ name: 'xl/worksheets/sheet1.xml', content: 'a'.repeat(4 * 1024 * 1024) }]);
    bomb.length.should.be.below(64 * 1024); // small going in
    await assertBoundedArchive(bomb, LIMITS).should.be.rejectedWith(/expands to more than/);
  });

  // The declared sizes are written by whoever made the file, so reading them
  // is a courtesy to honest uploads and not a control on dishonest ones.
  it('refuses one whose central directory understates it', async () => {
    const liar = zipOf([{
      name: 'xl/worksheets/sheet1.xml',
      content: 'a'.repeat(4 * 1024 * 1024),
      declare: 512
    }]);
    _readEntries(liar)[0].uncompressedSize.should.equal(512);
    await assertBoundedArchive(liar, LIMITS).should.be.rejectedWith(/expands to more than/);
  });

  // The other shape of the same attack: nothing large, simply too many.
  it('refuses an archive of too many parts', async () => {
    const many = zipOf(Array.from({ length: 9 }, (_, i) => ({ name: `p${i}.xml`, content: 'x' })));
    await assertBoundedArchive(many, LIMITS).should.be.rejectedWith(/more than 8 parts/);
  });

  it('refuses something that is not a zip at all', async () => {
    await assertBoundedArchive(Buffer.from('not a zip, just some bytes'), LIMITS)
      .should.be.rejectedWith(/not a readable/);
  });

  it('adds up across entries rather than checking each alone', async () => {
    // Each part is comfortably inside the budget; together they are not.
    const half = 'b'.repeat(700 * 1024);
    const pair = zipOf([
      { name: 'one.xml', content: half },
      { name: 'two.xml', content: half }
    ]);
    await assertBoundedArchive(pair, LIMITS).should.be.rejectedWith(/expands to more than/);
  });
});
