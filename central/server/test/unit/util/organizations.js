const Should = require('should'); // eslint-disable-line no-unused-vars
const { ORG_ROLES, normalizeOrganization, roleForOrganization, describeRoles } =
  require('../../../lib/util/organizations');

describe('(util) organizations', () => {
  describe('normalizeOrganization', () => {
    it('derives a slug from the name when none is given', () => {
      normalizeOrganization({ name: 'Bombali District Council' })
        .slug.should.equal('bombali-district-council');
    });

    it('takes a slug when one is given, lowercased', () => {
      normalizeOrganization({ name: 'Agency A', slug: 'Agency-A' })
        .slug.should.equal('agency-a');
    });

    // Slugs go in URLs, so anything that could change what a path means is
    // refused rather than escaped.
    it('refuses a slug that is not plainly a slug', () => {
      for (const slug of ['../etc', 'has space', 'UPPER ONLY!', '-leading', 'trailing-',
        'a', 'x'.repeat(65)]) {
        (() => normalizeOrganization({ name: 'x', slug }))
          .should.throw(/lowercase letters, digits and hyphens/);
      }
    });

    it('refuses a name that is only whitespace', () => {
      (() => normalizeOrganization({ name: '   ' })).should.throw(/give the organization a name/);
    });

    // A name of only punctuation derives to an empty slug, which must fail
    // loudly rather than produce an organization nobody can link to.
    it('refuses when a name derives to nothing usable', () => {
      (() => normalizeOrganization({ name: '!!!' }))
        .should.throw(/lowercase letters, digits and hyphens/);
    });
  });

  describe('roleForOrganization', () => {
    it('maps each organization role onto a role Central already has', () => {
      roleForOrganization('owner').system.should.equal('owner');
      roleForOrganization('manager').system.should.equal('manager');
      roleForOrganization('data-entry').system.should.equal('formfill');
      roleForOrganization('read-only').system.should.equal('viewer');
    });

    it('refuses a role it does not define, rather than guessing', () => {
      (() => roleForOrganization('editor')).should.throw(/must be one of/);
      (() => roleForOrganization('admin')).should.throw(/must be one of/);
      (() => roleForOrganization(undefined)).should.throw(/must be one of/);
    });

    // Ona has an "editor" between manager and viewer. Central does not, and
    // both ways to supply one are worse than leaving it out: mapping it to
    // manager grants more than the name promises, and inventing a verb set
    // means guessing at a security boundary.
    it('deliberately has no editor', () => {
      Should(ORG_ROLES.editor).be.undefined();
    });

    it('never maps an organization role onto site administrator', () => {
      Object.values(ORG_ROLES).map(role => role.system)
        .should.not.containEql('admin');
    });
  });

  describe('describeRoles', () => {
    it('explains each role in a sentence, for the person choosing one', () => {
      const described = describeRoles();
      described.map(role => role.name).should.eql(['owner', 'manager', 'data-entry', 'read-only']);
      described.forEach((role) => { role.describe.should.be.a.String(); });
    });
  });
});
