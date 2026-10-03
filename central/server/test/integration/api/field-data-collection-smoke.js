require('should');
const { testService } = require('../setup');
const testData = require('../../data/xml');

describe('api: published form to Field Data explorer', () => {
  it('lists a new form for OpenRosa and shows its collected submission', testService(async (service) => {
    const asAlice = await service.login('alice');

    await asAlice.post('/v1/projects/1/forms?publish=true&ignoreWarnings=true')
      .set('Content-Type', 'application/xml')
      .send(testData.forms.simple2)
      .expect(200);

    const listing = await asAlice.get('/v1/projects/1/formList')
      .set('X-OpenRosa-Version', '1.0')
      .expect(200);
    listing.headers['content-type'].should.equal('text/xml; charset=utf-8');
    listing.text.should.containEql('<formID>simple2</formID>');
    listing.text.should.containEql('<name>Simple 2</name>');
    listing.text.should.containEql('<version>2.1</version>');
    listing.text.should.match(/<downloadUrl>[^<]*\/projects\/1\/forms\/simple2\.xml<\/downloadUrl>/);

    await asAlice.post('/v1/projects/1/submission')
      .set('X-OpenRosa-Version', '1.0')
      .attach('xml_submission_file', Buffer.from(testData.instances.simple2.one),
        { filename: 'submission.xml' })
      .expect(201);

    const { body } = await asAlice.get('/v1/field-data/explore?form=simple2').expect(200);
    body.forms.find(form => form.form === 'simple2').submissions.should.equal(1);
    body.rows.find(row => row.instanceId === 's2one').form.should.equal('simple2');
  }));
});
