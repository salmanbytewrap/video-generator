import { extractPageMedia } from '../../../src/modules/asset/openGraph';

const PAGE = new URL('https://shop.example.com/products/trail-shoe');

describe('extractPageMedia', () => {
  it('extractPageMedia_WithVideoAndImage_ReturnsVideosFirst', () => {
    const html = `<html><head>
      <meta property="og:image" content="https://cdn.example.com/shoe.jpg">
      <meta property="og:video" content="https://cdn.example.com/shoe.mp4" />
      <meta property="og:title" content="Trail Shoe &amp; More">
    </head></html>`;

    expect(extractPageMedia(html, PAGE)).toEqual({
      title: 'Trail Shoe & More',
      candidates: ['https://cdn.example.com/shoe.mp4', 'https://cdn.example.com/shoe.jpg'],
    });
  });

  it('extractPageMedia_WithRelativeUrlsAndAttributeOrder_ResolvesAgainstPage', () => {
    const html = `<meta content='/img/hero.png' name='twitter:image'><meta content="hero.webp" property="og:image">`;

    expect(extractPageMedia(html, PAGE).candidates).toEqual([
      'https://shop.example.com/products/hero.webp',
      'https://shop.example.com/img/hero.png',
    ]);
  });

  it('extractPageMedia_WithoutOgTitle_FallsBackToTitleTag', () => {
    const html = '<title>\n  Trail   Shoe\n</title>';

    expect(extractPageMedia(html, PAGE)).toEqual({ title: 'Trail Shoe', candidates: [] });
  });

  it('extractPageMedia_DeduplicatesAndIgnoresEmptyContent', () => {
    const html = `<meta property="og:image" content="https://a.com/x.jpg"><meta property="og:image:secure_url" content="https://a.com/x.jpg"><meta property="og:video" content="">`;

    expect(extractPageMedia(html, PAGE).candidates).toEqual(['https://a.com/x.jpg']);
  });

  it('extractPageMedia_WithInvalidUrl_SkipsIt', () => {
    const html = `<meta property="og:image" content="http://[bad">`;

    expect(extractPageMedia(html, PAGE).candidates).toEqual([]);
  });
});
