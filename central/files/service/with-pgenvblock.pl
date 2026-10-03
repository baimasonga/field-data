#!/usr/bin/env perl

use warnings;
use strict;


die "Not enough arguments.\nUsage: with-pgenvblock.pl /path/to/envblock program [program-arg, …]\n" if @ARGV < 2;

my $envblockfile = $ARGV[0];

open my $fh, '<:raw', $envblockfile
    or die "Cannot open '" . $envblockfile . "': $!";
my $content = do { local $/; <$fh> };
close $fh;

my @entries = split /\x00/, $content;

for my $entry (@entries) {
    # Cron also needs the native storage/worker configuration and the public
    # CA bundle path. Keep an explicit allowlist rather than importing every
    # variable from the container environment.
    if ($entry =~ /\A(?<varname>PG[^=]+|FIELD_DATA_[A-Z0-9_]+|SUPABASE_[A-Z0-9_]+|NODE_EXTRA_CA_CERTS)=(?<varvalue>.*)\Z/m) {
        $ENV{$+{varname}} = $+{varvalue};
    }
}

exec @ARGV[1..$#ARGV]
    or die;
