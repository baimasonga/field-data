/*
Field photographs shown on the landing page.

Each entry names a file in `src/assets/images/landing/` and describes it. The
page renders only the entries whose file resolves and which carry both alt text
and a caption, so a half-described photograph is dropped rather than shown, and
an empty list leaves the section out entirely.

  file     the filename in src/assets/images/landing/
  alt      what is in the photograph, for anyone who cannot see it. Required.
  caption  the survey it illustrates, shown under the image. Required.

Captions name the kind of survey rather than a date, a district or a client,
because these images illustrate the work; they are not a record of a particular
round of it. See the README in the images directory before publishing a
photograph of an identifiable person.
*/

// eslint-disable-next-line import/prefer-default-export
export const landingPhotos = [
  {
    file: 'water-point-survey.webp',
    alt: 'An enumerator in a high-visibility vest holds a tablet showing a '
      + 'water point condition form while a resident looks on, beside a tap '
      + 'stand and a solar-powered water tank. A second enumerator records on '
      + 'a phone.',
    caption: 'Water point condition and flow'
  },
  {
    file: 'health-facility-survey.webp',
    alt: 'Two enumerators interview a nurse on the veranda of a health '
      + 'facility, one entering facility type and available services on a '
      + 'phone, the other taking notes on a tablet.',
    caption: 'Health facility readiness'
  },
  {
    file: 'school-survey.webp',
    alt: 'An enumerator with a tablet records a school name, respondent type '
      + 'and teacher count while a headteacher answers, seated outside a '
      + 'classroom block.',
    caption: 'School staffing and facilities'
  },
  {
    file: 'rice-farm-survey.webp',
    alt: 'An enumerator holds a tablet showing a household form with rice '
      + 'area, variety and irrigation access, talking with a farmer at the '
      + 'edge of a rice paddy.',
    caption: 'Smallholder rice production'
  },
  {
    file: 'market-trader-survey.webp',
    alt: 'An enumerator enters household type, main products and daily sales '
      + 'on a phone while a trader answers from behind a stall of vegetables '
      + 'at a coastal market.',
    caption: 'Market trader livelihoods'
  }
];
