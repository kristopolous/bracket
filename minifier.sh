in=db.js
out=db.min.js

before=`stat -c %s $out`
beforeCompress=`gzip -c $out | wc -c`
curl -s \
        -d compilation_level=SIMPLE_OPTIMIZATIONS \
        -d output_format=text \
        -d output_info=compiled_code \
        --data-urlencode "js_code@${in}" \
        http://closure-compiler.appspot.com/compile \
        > $out
after=`stat -c %s $out`
afterCompress=`gzip -c $out | wc -c`

echo "$before -> $after"
echo "$beforeCompress -> $afterCompress"
