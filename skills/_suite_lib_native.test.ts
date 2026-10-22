import test from 'node:test';
import assert from 'node:assert/strict';
import { truth,length,contains,count,at,slice,strip,lstrip,split,sorted,findall,search,sub } from './_suite_lib_native.js';
test('native containers and strings retain code-point and empty-container semantics',()=>{
 assert.equal(truth([]),false);assert.equal(truth({}),false);assert.equal(truth(new Set()),false);assert.equal(truth([0]),true);
 assert.equal(length('가🙂'),2);assert.equal(at('가🙂',-1),'🙂');assert.equal(slice('가🙂나',1,2),'🙂');assert.equal(contains({a:1},'a'),true);
 assert.equal(count([[1],[2],[1]],[1]),2);assert.equal(count([],1),0);
 assert.equal(contains([['-s','read-only']],['-s','read-only']),true);assert.equal(contains([['-s','read-only']],['-s','workspace-write']),false);assert.equal(contains(new Set([[1,{mode:'read-only'}]]),[1,{mode:'read-only'}]),true);
 assert.deepEqual(sorted(['\u{10000}','\ue000']),['\ue000','\u{10000}']);
 assert.equal(strip('\u0085 text \u001c'),'text');assert.equal(strip('\ufefftext\ufeff'),'\ufefftext\ufeff');assert.equal(strip('🙂x🙂','🙂'),'x');
 assert.equal(lstrip('  a  '),'a  ');assert.deepEqual(split(' a  b   c ',undefined,1),['a','b   c ']);assert.deepEqual(split('   '),[]);assert.deepEqual(split('a/b/c','/',1),['a','b/c']);
});
test('Unicode words, digits, whitespace, and line anchors retain the source-pattern meaning',()=>{
 assert.deepEqual(findall('\\b\\w+\\b','한글 abc café １２ 🙂'),['한글','abc','café','１２']);
 assert.deepEqual(findall('\\d+','１２ 12'),['１２','12']);assert.deepEqual(findall('\\s','\u0085\u001c\ufeff'),['\u0085','\u001c']);
 assert.equal(search('(?<![\\w-])`([a-z]+)`\\s*skill\\b','한글`plan` skill'),null);
 assert.equal(search('\\bskill\\b','skill한글'),null);
 assert.deepEqual(findall('.','a\u2028b'),['a','\u2028','b']);assert.deepEqual(findall('(?m)^a$','a\r\na\na'),['a','a']);
 assert.deepEqual(findall('(?m)^\\| (.+?) \\|$','| 행 |\n| x |'),['행','x']);
 assert.equal(sub('(a)','\\1!','ab'),'a!b');
});
