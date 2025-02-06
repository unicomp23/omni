cp diffs.patch ./target.src
cd target.src
patch -p1 < diffs.patch -r rejects.txt
rm diffs.patch
