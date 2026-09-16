import { describe, expect, it } from '@jest/globals';
import { parseAnimeEpisode } from '@project/common/llm-analysis';

describe('parseAnimeEpisode', () => {
    it('parses fansub " - NN" episode numbers and strips release tags', () => {
        expect(parseAnimeEpisode("[NanakoRaws] BanG Dream! It's MyGO!!!!! - 01 (1080p).mkv")).toEqual({
            anime: "BanG Dream! It's MyGO!!!!!",
            episode: '01',
        });
    });

    it('parses SxxEyy from scene-style names', () => {
        expect(parseAnimeEpisode('Show.Name.S01E05.1080p.WEB-DL.mkv')).toEqual({
            anime: 'Show Name',
            episode: 'S01E05',
        });
    });

    it('parses Japanese 第NN話 markers', () => {
        expect(parseAnimeEpisode('[字幕组] 孤独摇滚 第03話 [简繁].ass')).toEqual({
            anime: '孤独摇滚',
            episode: '03',
        });
    });

    it('parses SubsPlease-style " - NN" with trailing hash tag', () => {
        expect(parseAnimeEpisode('[SubsPlease] Sousou no Frieren - 28 (1080p) [F1234].srt')).toEqual({
            anime: 'Sousou no Frieren',
            episode: '28',
        });
    });

    it('parses EPNN suffixes', () => {
        expect(parseAnimeEpisode('Kaguya-sama wa Kokurasetai EP07.srt')).toEqual({
            anime: 'Kaguya-sama wa Kokurasetai',
            episode: '07',
        });
    });

    it('parses a bare trailing number without eating the title', () => {
        expect(parseAnimeEpisode('Steins;Gate 09.ass')).toEqual({
            anime: 'Steins;Gate',
            episode: '09',
        });
    });

    it('degrades gracefully when there is no episode marker', () => {
        expect(parseAnimeEpisode('random_movie.mkv')).toEqual({
            anime: 'random movie',
            episode: '',
        });
    });

    it('returns empty fields for empty input', () => {
        expect(parseAnimeEpisode('')).toEqual({ anime: '', episode: '' });
        expect(parseAnimeEpisode(undefined)).toEqual({ anime: '', episode: '' });
    });
});
