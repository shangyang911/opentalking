"""Include repository-owned model defaults in built Python distributions."""

from pathlib import Path
from shutil import copy2

from setuptools import setup
from setuptools.command.build_py import build_py


class BuildWithConfigs(build_py):
    def run(self):
        super().run()
        source = Path(__file__).parent / "configs"
        for config in source.rglob("*.yaml"):
            target = Path(self.build_lib) / "opentalking" / "configs" / config.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            copy2(config, target)


setup(cmdclass={"build_py": BuildWithConfigs})
