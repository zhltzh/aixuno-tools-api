#!/usr/bin/env python3
# AI old-photo restoration pipeline: GFPGAN (face enhancement) + Real-ESRGAN (upscale).
# Usage: python restore.py --input in.jpg --output out.png --scale 2 [--no-face]
# Missing optional deps degrade gracefully (warn + fallback) instead of failing.
import argparse
import os
import sys


def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)


def resolve_model(name):
    model_dir = os.environ.get(
        'AIXUNO_AI_MODELS',
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models'),
    )
    return os.path.join(model_dir, name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--scale', type=int, default=2, choices=[1, 2, 4])
    parser.add_argument('--no-face', action='store_true')
    args = parser.parse_args()

    try:
        import cv2
    except ImportError:
        fail('missing dependency: opencv-python-headless (pip install -r requirements.txt)')

    if not os.path.isfile(args.input):
        fail(f'input not found: {args.input}')

    img = cv2.imread(args.input, cv2.IMREAD_COLOR)
    if img is None:
        fail('failed to read input image')

    if not args.no_face:
        try:
            from gfpgan import GFPGANer
            restorer = GFPGANer(
                model_path=resolve_model('GFPGANv1.4.pth'),
                upscale=1,
                arch='clean',
                channel_multiplier=2,
            )
            _, _, restored = restorer.enhance(
                img, has_aligned=False, only_center_face=False, paste_back=True,
            )
            img = restored
        except ImportError:
            print('WARN: gfpgan not installed, skipping face enhancement', file=sys.stderr)
        except Exception as exc:
            print(f'WARN: face enhancement failed ({exc}), continuing without it', file=sys.stderr)

    if args.scale > 1:
        done = False
        try:
            from realesrgan import RealESRGANer
            from basicsr.archs.rrdbnet_arch import RRDBNet
            model = RRDBNet(
                num_in_ch=3, num_out_ch=3, num_feat=64, num_block=23, num_grow_ch=32, scale=4,
            )
            upsampler = RealESRGANer(
                scale=4,
                model_path=resolve_model('RealESRGAN_x4plus.pth'),
                model=model,
                tile=256,
                tile_pad=10,
                pre_pad=0,
                half=False,
            )
            output, _ = upsampler.enhance(img, outscale=args.scale)
            img = output
            done = True
        except ImportError:
            print('WARN: realesrgan not installed, falling back to lanczos resize', file=sys.stderr)
        except Exception as exc:
            print(f'WARN: AI upscaling failed ({exc}), falling back to lanczos resize', file=sys.stderr)
        if not done:
            img = cv2.resize(
                img,
                (img.shape[1] * args.scale, img.shape[0] * args.scale),
                interpolation=cv2.INTER_LANCZOS4,
            )

    out_dir = os.path.dirname(os.path.abspath(args.output))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    if not cv2.imwrite(args.output, img):
        fail('failed to write output image')
    print('OK')


if __name__ == '__main__':
    main()
