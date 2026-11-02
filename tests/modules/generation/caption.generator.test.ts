import { extractTopic, SimulatedCaptionGenerator } from '../../../src/modules/generation/caption.generator';

describe('SimulatedCaptionGenerator', () => {
  const generator = new SimulatedCaptionGenerator();

  it('extractTopic_FromFileName_StripsExtensionNoiseAndNumbers', () => {
    expect(extractTopic(undefined, 'IMG_2024_cool-running_shoes_final.mp4')).toEqual({
      topic: 'cool running shoes',
      keywords: ['cool', 'running', 'shoes'],
    });
  });

  it('extractTopic_PrefersTitleOverFileName', () => {
    expect(extractTopic('Acme Water Bottle', 'x.mp4').topic).toBe('Acme Water Bottle');
  });

  it('extractTopic_WithNoUsableWords_FallsBackToGenericTopic', () => {
    expect(extractTopic(undefined, '123.mp4')).toEqual({ topic: 'this product', keywords: [] });
  });

  it('generate_ForTikTok_IncludesTopicPlatformTagsAndSimulatedFlag', async () => {
    const caption = await generator.generate({ platform: 'tiktok', format: 'vertical', originalName: 'Cool Sneakers.mp4' });

    expect(caption.text).toContain('Cool Sneakers');
    expect(caption.hashtags).toEqual(['#cool', '#sneakers', '#fyp', '#tiktokmademebuyit', '#viral']);
    expect(caption.simulated).toBe(true);
  });

  it('generate_SameInput_IsDeterministic', async () => {
    const ctx = { platform: 'youtube' as const, format: 'short', originalName: 'Desk Lamp.mov' };

    expect(await generator.generate(ctx)).toEqual(await generator.generate(ctx));
  });
});
