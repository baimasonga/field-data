#!/usr/bin/env python3
"""Link this skill bundle into a Codex skill-discovery directory."""
import argparse
import os
from pathlib import Path

bundle = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--destination', type=Path, default=bundle.parent / '.agents' / 'skills')
args = parser.parse_args()
destination = args.destination.expanduser().absolute()
packages = sorted(path.parent for path in bundle.glob('*/SKILL.md'))
conflicts = [destination / package.name for package in packages
             if os.path.lexists(destination / package.name)
             and (destination / package.name).resolve() != package.resolve()]
if conflicts:
    parser.error('Existing paths would conflict: ' + ', '.join(map(str, conflicts)))
try:
    destination.mkdir(parents=True, exist_ok=True)
    for package in packages:
        link = destination / package.name
        if not os.path.lexists(link):
            link.symlink_to(os.path.relpath(package, destination), target_is_directory=True)
except OSError as error:
    parser.exit(1, f'Installation failed: {error}. Use a writable discovery directory or invoke the SKILL.md files by path.\n')
print(f'Installed {len(packages)} skills in {destination}')
