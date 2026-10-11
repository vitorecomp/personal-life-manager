from setuptools import setup, find_packages

setup(
    name='game_interaction_service',
    version='0.1.0',
    packages=find_packages(),
    install_requires=[
        'selenium==4.0.0',  
    ],
)