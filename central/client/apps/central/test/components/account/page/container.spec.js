import AccountPageContainer from '../../../../src/components/account/page/container.vue';

import testData from '../../../data';
import { mergeMountOptions, mount } from '../../../util/lifecycle';

const mountComponent = (options = undefined) =>
  mount(AccountPageContainer, mergeMountOptions(options, {
    container: {
      requestData: { serverConfig: testData.standardConfigs.byKey() }
    }
  }));

describe('AccountPageContainer', () => {
  describe('logo', () => {
    it('shows the default logo if a custom one has not been configured', () => {
      const component = mountComponent();
      const img = component.findAll('#account-page-container-logo img');
      img.length.should.equal(1);
      // Asserting on `alt` rather than `src` because `src` ends up being a data
      // URL. Probably from Vite, maybe because the logo is small.
      img[0].attributes().alt.should.equal('Field Data logo');
    });

    it('shows a custom logo', () => {
      testData.standardConfigs.createPast(1, { key: 'logo', blobExists: true });
      const component = mountComponent();
      const img = component.findAll('#account-page-container-logo img');
      img.length.should.equal(1);
      img[0].attributes().alt.should.equal('Organization logo');
    });
  });

  describe('hero image', () => {
    it('shows a custom hero image', () => {
      testData.standardConfigs.createPast(1, { key: 'hero-image', blobExists: true });
      const component = mountComponent();
      const { backgroundImage } = component.get('#account-page-container-brand').element.style;
      backgroundImage.should.contain('linear-gradient(');
      backgroundImage.should.contain('/v1/config/public/hero-image?');
    });

    it('does not show a hero image if one has not been configured', () => {
      const component = mountComponent();
      component.get('#account-page-container-brand').element.style.backgroundImage.should.equal('');
    });
  });

  it('uses a cache-busting query parameter', () => {
    testData.standardConfigs.createPast(1, {
      key: 'hero-image',
      blobExists: true,
      setAt: '1970-01-01T00:00:00.123Z'
    });
    const component = mountComponent();
    component.get('#account-page-container-brand').element.style.backgroundImage
      .should.contain('url("/v1/config/public/hero-image?ts=123")');
  });

  it('is inert during preview', () => {
    const component = mountComponent({
      props: { preview: true }
    });
    should.exist(component.attributes().inert);
  });
});
