// Small, dependency-free delimited-text parser for local/offline imports.
export function detectDelimiter(text){
  const firstLine=text.replace(/^\uFEFF/,'').split(/\r?\n/).find(line=>line.trim())||'';
  const candidates=[',','\t',';'];
  return candidates.sort((a,b)=>countOutsideQuotes(firstLine,b)-countOutsideQuotes(firstLine,a))[0];
}
function countOutsideQuotes(line,delimiter){let quoted=false,count=0;for(let i=0;i<line.length;i++){if(line[i]==='"'&&line[i+1]==='"'){i++;continue}if(line[i]==='"')quoted=!quoted;else if(!quoted&&line[i]===delimiter)count++}return count}
export function parseDelimited(text,delimiter=detectDelimiter(text)){
  const rows=[];let row=[],cell='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===delimiter&&!quoted){row.push(cell);cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row);row=[];cell=''}else cell+=ch}
  if(cell!==''||row.length){row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row)}
  if(!rows.length)return {headers:[],rows:[],delimiter};
  const headers=rows[0].map((v,i)=>v.trim()||`Column ${i+1}`);return {headers,rows:rows.slice(1).map(r=>headers.map((_,i)=>(r[i]??'').trim())),delimiter};
}
export function toCsv(headers,rows){const quote=value=>{const s=String(value??'');return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s};return [headers, ...rows].map(row=>row.map(quote).join(',')).join('\n')+'\n'}
