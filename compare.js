#!/usr/bin/env node

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// Emulate __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extractFrames = (videoPath, outputDir, frameCount) => {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        ffmpeg(videoPath)
            .on('end', () => {
                const files = fs
                    .readdirSync(outputDir)
                    .filter((file) => file.endsWith('.png'))
                    .sort();
                resolve(files.map((file) => path.join(outputDir, file)));
            })
            .on('error', reject)
            .outputOptions([
                '-vf',
                `select=not(mod(n\\,${Math.floor(100 / frameCount)}))`,
                '-vsync',
                'vfr',
                '-q:v',
                '2',
            ])
            .output(path.join(outputDir, 'frame_%03d.png'))
            .run();
    });
};

const generateDifferenceFrames = (framesA, framesB, outputDir) => {
    if (framesA.length !== framesB.length) {
        throw new Error('Frame counts do not match.');
    }

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let totalPixels = 0;
    let changedPixels = 0;

    framesA.forEach((frameAPath, index) => {
        const frameBPath = framesB[index];
        const imgA = PNG.sync.read(fs.readFileSync(frameAPath));
        const imgB = PNG.sync.read(fs.readFileSync(frameBPath));

        if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
            throw new Error('Frame dimensions do not match.');
        }

        const { width, height } = imgA;
        const diff = new PNG({ width, height });

        const frameChangedPixels = pixelmatch(
            imgA.data,
            imgB.data,
            diff.data,
            width,
            height,
            {
                threshold: 0.1,
                includeAA: true,
            }
        );

        changedPixels += frameChangedPixels;
        totalPixels += width * height;

        const outputFilePath = path.join(outputDir, `diff_${index + 1}.png`);
        fs.writeFileSync(outputFilePath, PNG.sync.write(diff));
    });

    const percentChanged = (changedPixels / totalPixels) * 100;
    return percentChanged;
};

const encodeDiffVideo = (inputDir, outputVideo) => {
    return new Promise((resolve, reject) => {
        ffmpeg()
            .input(path.join(inputDir, 'diff_%d.png'))
            .inputOptions('-framerate 10') // Adjust frame rate as needed
            .outputOptions([
                '-c:v prores_ks', // ProRes codec
                '-profile:v 4444', // ProRes 4444 profile for alpha channel
                '-pix_fmt yuva444p10le', // Pixel format supporting alpha
            ])
            .output(outputVideo)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });
};

const main = async () => {
    const args = process.argv.slice(2);

    if (args.length !== 3) {
        console.error('Usage: node compare_and_generate.js <movie1> <movie2> <output.mov>');
        process.exit(1);
    }

    const [videoPathA, videoPathB, outputVideo] = args;

    const tempDirA = path.join(__dirname, 'tempA');
    const tempDirB = path.join(__dirname, 'tempB');
    const diffDir = path.join(__dirname, 'diffFrames');

    try {
        console.log('Extracting frames from the first video...');
        const framesA = await extractFrames(videoPathA, tempDirA, 10);

        console.log('Extracting frames from the second video...');
        const framesB = await extractFrames(videoPathB, tempDirB, 10);

        console.log('Generating difference frames and calculating pixel changes...');
        const percentChanged = generateDifferenceFrames(framesA, framesB, diffDir);

        console.log('Encoding difference video...');
        await encodeDiffVideo(diffDir, outputVideo);

        console.log(`Difference video generated: ${outputVideo}`);
        console.log(`Percentage of changed pixels: ${percentChanged.toFixed(2)}%`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        fs.rmSync(tempDirA, { recursive: true, force: true });
        fs.rmSync(tempDirB, { recursive: true, force: true });
        fs.rmSync(diffDir, { recursive: true, force: true });
    }
};

main();
